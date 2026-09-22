require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.warn("⚠️ DATABASE_URL ou JWT_SECRET manque dans les variables d'environnement.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      category VARCHAR(60) NOT NULL,
      city VARCHAR(100) NOT NULL,
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ads_created_at_idx ON ads(created_at DESC);
    CREATE INDEX IF NOT EXISTS ads_category_idx ON ads(category);
    CREATE INDEX IF NOT EXISTS ads_city_idx ON ads(city);
  `);
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Connexion requise." });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expirée." });
  }
}

app.get("/api/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch {
    res.json({ user: null });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Tous les champs sont obligatoires." });
    }
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: "Nom invalide." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [normalizedEmail]);
    if (exists.rowCount) {
      return res.status(409).json({ error: "Cette adresse e-mail est déjà utilisée." });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name.trim(), normalizedEmail, hash]
    );

    const user = result.rows[0];
    setAuthCookie(res, createToken(user));
    res.status(201).json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    const result = await pool.query(
      "SELECT id,name,email,password_hash FROM users WHERE email=$1",
      [normalizedEmail]
    );
    if (!result.rowCount) return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password || "", user.password_hash);
    if (!ok) return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });

    const safeUser = { id: user.id, name: user.name, email: user.email };
    setAuthCookie(res, createToken(safeUser));
    res.json({ user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/ads", async (req, res) => {
  try {
    const { q = "", category = "", city = "" } = req.query;
    const params = [];
    const where = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`a.category = $${params.length}`);
    }
    if (city) {
      params.push(`%${city}%`);
      where.push(`a.city ILIKE $${params.length}`);
    }

    const sql = `
      SELECT a.id,a.title,a.description,a.price,a.category,a.city,a.image_url,a.created_at,
             u.name AS seller_name
      FROM ads a
      JOIN users u ON u.id=a.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.created_at DESC
      LIMIT 100
    `;
    const result = await pool.query(sql, params);
    res.json({ ads: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Impossible de charger les annonces." });
  }
});

app.post("/api/ads", auth, async (req, res) => {
  try {
    const { title, description, price, category, city, image_url } = req.body;

    if (!title || !description || price === undefined || !category || !city) {
      return res.status(400).json({ error: "Remplis tous les champs obligatoires." });
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: "Prix invalide." });
    }

    const result = await pool.query(
      `INSERT INTO ads(user_id,title,description,price,category,city,image_url)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,title,description,price,category,city,image_url,created_at`,
      [
        req.user.id,
        String(title).trim().slice(0,120),
        String(description).trim(),
        numericPrice,
        String(category).trim(),
        String(city).trim(),
        image_url ? String(image_url).trim() : null
      ]
    );

    res.status(201).json({ ad: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Impossible de créer l'annonce." });
  }
});

app.delete("/api/ads/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM ads WHERE id=$1 AND user_id=$2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Annonce introuvable." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Impossible de supprimer l'annonce." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));
  })
  .catch((err) => {
    console.error("Erreur DB:", err);
    process.exit(1);
  });