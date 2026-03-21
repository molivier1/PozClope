# 24h du code

## Commandes

### Afficher la carte

Instance 1 → node server.js

Permet de faire tourner le leaderboard

Instance 2 → npm.cmd run dev


### Afficher nos vaisseaux

npm.cmd run game -- team        

npm.cmd run game -- ships

### Infos market

npm.cmd run getmodel -- --json











## Lancement

```powershell
npm.cmd start
```

Puis ouvre `http://localhost:3000`.

## Variables d'environnement

Minimum:

```dotenv
API_URL=http://37.187.156.222:8080
TEAM_ID=8503fb81-528b-4b2d-8b1f-783bcc8bf6db
TOKEN=...
```

Pour renouveler automatiquement le token Keycloak:

```dotenv
AUTH_URL=http://37.187.156.222:8081
KEYCLOAK_REALM=24hcode
KEYCLOAK_CLIENT_ID=vaissals-backend
KEYCLOAK_USERNAME=...
KEYCLOAK_PASSWORD=...
```

`TOKEN` peut rester present comme secours au demarrage, mais le refresh automatique repose sur `KEYCLOAK_USERNAME` et `KEYCLOAK_PASSWORD`.
