# Annonceo — site d'annonces

Projet prêt à être envoyé sur GitHub puis déployé sur Render.

## Fonctions incluses

- Inscription
- Connexion / déconnexion
- Mots de passe chiffrés avec bcrypt
- Session sécurisée par cookie HTTP-only + JWT
- Création d'annonces
- Recherche par mot-clé
- Filtre par catégorie
- Filtre par ville
- Prix, description, vendeur et localisation
- Base PostgreSQL
- Interface responsive téléphone / PC

## 1. En local

Installer Node.js 20+ puis :

```bash
npm install
```

Créer `.env` à partir de `.env.example`, puis renseigner :

```env
DATABASE_URL=...
JWT_SECRET=une-longue-cle-secrete
PORT=10000
NODE_ENV=development
```

Lancer :

```bash
npm start
```

## 2. GitHub

Créer un dépôt public et envoyer tous les fichiers de ce dossier.

## 3. Render

Créer un **Web Service** connecté au dépôt GitHub.

- Build Command : `npm install`
- Start Command : `npm start`

Ajouter les variables d'environnement :

- `DATABASE_URL` = URL de la base PostgreSQL Render
- `JWT_SECRET` = une longue clé aléatoire
- `NODE_ENV` = `production`

Le serveur crée automatiquement les tables `users` et `ads` au premier démarrage.

## Important

La version actuelle utilise des **liens d'images** dans les annonces. Pour une vraie marketplace plus avancée, on pourra ensuite ajouter l'envoi direct de photos, messagerie entre acheteur/vendeur, favoris, modération, paiement, profils vendeurs et panneau administrateur.
