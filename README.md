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

Serveur local + front :

```powershell
npm.cmd start
```

Puis ouvrir :

```text
http://localhost:3000
```

Mode dev front :

```powershell
npm.cmd run dev
```

Serveur Node avec reload :

```powershell
npm.cmd run server:dev
```

## Variables d'environnement

Minimum :

```dotenv
API_URL=http://37.187.156.222:8080
TEAM_ID=8503fb81-528b-4b2d-8b1f-783bcc8bf6db
TOKEN=...
```

Pour renouveler automatiquement le token :

```dotenv
AUTH_URL=http://37.187.156.222:8081
KEYCLOAK_REALM=24hcode
KEYCLOAK_CLIENT_ID=vaissals-backend
KEYCLOAK_USERNAME=...
KEYCLOAK_PASSWORD=...
```

Notes :
- `TOKEN` doit rester sur une seule ligne.
- `.env` peut etre a la racine ou dans `Backend/.env`.
- si `TOKEN` expire, le script tente de passer par Keycloak si les variables sont presentes.

## Commandes utiles

### Observer l'etat du jeu

Voir vos vaisseaux :

```powershell
npm.cmd run game -- ships
```

Voir vos ressources :

```powershell
npm.cmd run game -- team
```

Voir les credits des autres equipes :

```powershell
npm.cmd run game -- credits
```

Voir une case precise :

```powershell
npm.cmd run game -- cell 5 40
```

Snapshot complet lisible :

```powershell
npm.cmd run getmodel
```

Snapshot complet en JSON :

```powershell
npm.cmd run getmodel -- --json
```

### Jouer a la main

Deplacer un vaisseau :

```powershell
npm.cmd run game -- move "Chasseur M 1" 10 46
```

Recolter :

```powershell
npm.cmd run game -- harvest "Cargo L 1" 10 41
```

Deposer :

```powershell
npm.cmd run game -- deposit "Cargo L 1" 5 44
```

Attaquer :

```powershell
npm.cmd run game -- attack "Chasseur M 1" 1 33
```

Conquerir :

```powershell
npm.cmd run game -- conquer "Chasseur M 1" 1 33
```

Reparer :

```powershell
npm.cmd run game -- repair "Chasseur M 1" 5 44
```

### Construction et marche

Voir ce que vos planetes peuvent construire :

```powershell
npm.cmd run game -- build-options
```

Acheter un plan par classe :

```powershell
npm.cmd run game -- buy-plan CHASSEUR_MOYEN
npm.cmd run game -- buy-plan CARGO_LOURD
```

Construire un vaisseau a partir d'une classe :

```powershell
npm.cmd run game -- build-ship CHASSEUR_MOYEN "Chasseur M 3"
npm.cmd run game -- build-ship CARGO_LOURD "Cargo L 5"
```

Acheter une offre directement par id :

```powershell
npm.cmd run game -- buy-offer "uuid-offre"
```

Raccourcis encore presents :

```powershell
npm.cmd run game -- buy-fighter-plan
npm.cmd run game -- build-fighter "Chasseur 6"
npm.cmd run game -- build-cargo "Cargo 1"
npm.cmd run game -- buy-cargo-medium-plan
npm.cmd run game -- build-cargo-medium "Cargo M 2"
```

### Module avance

Acheter le chantier avance :

```powershell
npm.cmd run game -- buy-advanced-yard
```

Le poser sur une planete :

```powershell
npm.cmd run game -- place-advanced-yard "Bryyo Prime"
```

## Scripts automatiques

### Auto-farm mono-vaisseau

```powershell
npm.cmd run farm -- "Chasseur leger 0" 6 40 5 44 5000
```

### Auto-farm cargos

Par defaut, ce script ne pilote que les `CARGO_MOYEN` et `CARGO_LOURD` :

```powershell
npm.cmd run farm-cargos
```

Avec une boucle plus lente :

```powershell
npm.cmd run farm-cargos -- 7000
```

Pour reinclure aussi les `CARGO_LEGER` :

```powershell
$env:FARM_INCLUDE_LIGHT='1'
npm.cmd run farm-cargos
```

Note :
- un verrou empeche maintenant de lancer deux `farm-cargos` en parallele.

### Siege automatique

Lancer un siege auto avec quelques chasseurs :

```powershell
npm.cmd run siege:auto -- "chasseur 4" "Chasseur 5" "Chasseur M 1" "Chasseur M 3"
```

Comportement :
- explore si aucune cible ennemie n'est visible,
- attaque les planetes ennemies visibles,
- tente `CONQUERIR` quand la planete arrive a `0 PV`,
- ignore temporairement les capitales non attaquables.

Option pour inclure aussi les planetes neutres :

```powershell
$env:SIEGE_INCLUDE_NEUTRAL='1'
npm.cmd run siege:auto -- "Chasseur M 1" "Chasseur M 3"
```

### Watcher socket

Commande :

```powershell
npm.cmd run socket-watch
```

Variables utiles :

```dotenv
SOCKET_URL=ws://...
SOCKET_INCLUDE_TOKEN=1
SOCKET_TOKEN_PARAM=token
SOCKET_ON_OPEN={"type":"subscribe","channel":"events"}
SOCKET_HEARTBEAT_MS=30000
SOCKET_HEARTBEAT_MESSAGE={"type":"ping"}
SOCKET_ALERT_MATCH=attack,conquer,market
SOCKET_LOG_FILE=logs/socket-events.ndjson
```

Comportement :
- reconnexion automatique,
- log permanent dans un fichier NDJSON,
- alerte sonore simple si un message contient un mot cle defini dans `SOCKET_ALERT_MATCH`,
- verrou anti double-process.

## Depannage rapide

Token expire :

```text
401 Unauthorized: token invalide ou expire
```

Causes probables :
- `TOKEN` expire,
- Keycloak inaccessible,
- variables Keycloak absentes ou incorrectes.

Si `farm-cargos` semble envoyer des ordres contradictoires :
- verifier qu'un seul terminal execute `npm.cmd run farm-cargos`,
- arreter les anciens scripts avec `Ctrl + C`,
- relancer une seule fois le script.

Si un vaisseau est en cooldown :

```text
423 Vaisseau indisponible, prochaine disponibilite : ...
```

C'est normal. Le script attendra automatiquement la prochaine fenetre d'action.
