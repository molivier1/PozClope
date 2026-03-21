import 'dotenv/config';
import { getFullMap } from './getFullMap.js';
import { getAllVaisseaux } from './getAllVaisseaux.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { attaquer } = require('./attaquer.js');
const { deplacer } = require('./deplacer.js');
const { conquerir } = require('./conquerir.js');

// --- CONFIGURATION ---
const DELAY_MS = 1000; // Temps entre chaque tour de boucle

const MES_VAISSEAUX_IDS = [
  '54053e0c-14ea-4946-89d5-d640e4e9e2a2'
];

// --- ETAT GLOBAL ---
const cooldowns = {}; // Stocke les temps d'attente : { idVaisseau: timestampFin }
const failedMoves = new Set(); // Stocke les mouvements échoués : "idVaisseau,x,y"

function updateCooldown(idVaisseau, errorMsg) {
  // Analyse du message : "Vaisseau indisponible, prochaine disponibilité : 21:48:13"
  const match = errorMsg.match(/prochaine disponibilité\s*:\s*(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [_, h, m, s] = match;
    const now = new Date();
    const nextAction = new Date();
    nextAction.setHours(parseInt(h, 10), parseInt(m, 10), parseInt(s, 10), 0);

    // On ajoute 1 seconde de sécurité pour être sûr que le serveur valide l'action suivante
    const releaseTime = nextAction.getTime() + 1000; 

    cooldowns[idVaisseau] = releaseTime;
    console.log(`⏳ Cooldown détecté pour ${idVaisseau.slice(0, 5)} -> Reprise à ${h}:${m}:${s}`);
  }
}

// --- FONCTIONS API ---

async function actionDeplacer(idVaisseau, x, y) {
  try {
    const res = await deplacer(idVaisseau, x, y);
    return res;
  } catch (e) {
    console.error(`Erreur déplacement ${idVaisseau}:`, e.message);
    updateCooldown(idVaisseau, e.message);

    // Si le mouvement est bloqué (obstacle ou vide), on l'ajoute à la liste noire temporaire
    if (e.message.includes("inaccessible") || e.message.includes("obstacle") || e.message.includes("403") || e.message.includes("400")) {
      const key = `${idVaisseau},${x},${y}`;
      failedMoves.add(key);
      setTimeout(() => failedMoves.delete(key), 10000); // On oublie cet obstacle après 10 secondes
    }
  }
}

async function actionAttaquer(idAttaquant, x, y) {
  try {
    const res = await attaquer(idAttaquant, x, y);
    console.log(`⚔️  ${idAttaquant.slice(0, 5)} attaque (${x}, ${y}):`, res.message || res);
    return res;
  } catch (e) {
    console.error(`Erreur attaque ${idAttaquant}:`, e.message);
    updateCooldown(idAttaquant, e.message);
  }
}

async function actionConquerir(idVaisseau, x, y) {
  try {
    const res = await conquerir(idVaisseau, x, y);
    console.log(`🚩 ${idVaisseau.slice(0, 5)} conquiert la planète (${x}, ${y}):`, res.message || res);
    return res;
  } catch (e) {
    console.error(`Erreur conquête ${idVaisseau}:`, e.message);
    updateCooldown(idVaisseau, e.message);
  }
}

// --- LOGIQUE MÉTIER ---

function getDistance(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); // Distance de Chebyshev (déplacement en grille)
}

async function gererVaisseau(vaisseau, mapCases, ennemis, occupiedSet, mapLookup) {
  if (!vaisseau) return;

  console.log(`🤖 Gestion de ${vaisseau.nom} (${vaisseau.coord_x}, ${vaisseau.coord_y})`);

  // S'assurer que les coordonnées sont bien des nombres pour éviter le bug "30" + 1 = "301"
  const vX = parseInt(vaisseau.coord_x, 10);
  const vY = parseInt(vaisseau.coord_y, 10);

  // Vérifier si le vaisseau est en repos forcé
  if (cooldowns[vaisseau.idVaisseau]) {
    const now = Date.now();
    if (now < cooldowns[vaisseau.idVaisseau]) {
      return; // On passe au tour suivant sans rien faire pour ce vaisseau
    }
  }

  // 1. Identifier les cibles potentielles (Planètes ennemies/neutres ou Vaisseaux ennemis)
  // On extrait les planètes de la map qui ne sont pas à nous
  const planetesCibles = mapCases
    .filter(c => c.planete && c.planete.proprietaire?.idEquipe !== vaisseau.proprietaire && c.planete.proprietaire?.id !== vaisseau.proprietaire && c.planete.proprietaire?.nom !== 'PozClope' && c.planete.proprietaire?.nom !== 'Sudo Win')
    .map(c => ({
      id: c.planete.idPlanete,
      x: c.coord_x,
      y: c.coord_y,
      hp: c.planete.pointDeVie || 0, // Assumons que l'API renvoie les HP
      type: 'Planete',
      equipe: c.planete.proprietaire?.nom || 'Inconnue'
    }));

  const vaisseauxCibles = ennemis.map(e => ({
    id: e.idVaisseau,
    x: e.coord_x,
    y: e.coord_y,
    hp: e.pointDeVie,
    type: 'Vaisseau',
    equipe: e.equipe
  }));

  const toutesCibles = [...planetesCibles, ...vaisseauxCibles];

  if (toutesCibles.length === 0) {
    console.log(`- Pas de cible visible pour ${vaisseau.nom}`);
    return;
  }

  // 2. Trouver la cible la plus proche
  toutesCibles.sort((a, b) => {
    const distA = getDistance(vX, vY, a.x, a.y);
    const distB = getDistance(vX, vY, b.x, b.y);
    return distA - distB;
  });

  const cible = toutesCibles[0];
  const distance = getDistance(vX, vY, cible.x, cible.y);

  // LOG: Afficher la cible choisie
  console.log(`   🎯 Cible : ${cible.type} [${cible.id.slice(0, 5)}] de l'équipe "${cible.equipe}" à (${cible.x}, ${cible.y}) - HP: ${cible.hp}`);

  // 3. Décider de l'action
  // Le vaisseau attaque s'il est adjacent (distance 1).
  // Suite à votre demande, on tente aussi l'attaque à distance 2 pour arrêter de boucler sur des déplacements impossibles quand le vaisseau est proche mais bloqué.
  if (distance <= 2) {
    if (cible.type === 'Planete' && cible.hp <= 0) {
      // CONQUÊTE
      await actionConquerir(vaisseau.idVaisseau, cible.x, cible.y);
    } else {
      // ATTAQUE (Vaisseau ou Planète avec HP)
      await actionAttaquer(vaisseau.idVaisseau, cible.x, cible.y);
    }
  } else {
    // MOUVEMENT : Avancer d'une case vers la cible
    // Stratégie "Pathfinding Local" (Inspiré de siege.js)
    // On regarde les 8 cases autour et on prend la meilleure valide qui rapproche de la cible.

    const candidates = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        candidates.push({ x: vX + dx, y: vY + dy });
      }
    }

    // Filtrer les candidats valides
    const validMoves = candidates.filter(pos => {
      // 1. Limites de la carte (0-57)
      if (pos.x < 0 || pos.x > 57 || pos.y < 0 || pos.y > 57) return false;

      const key = `${pos.x},${pos.y}`;

      // 2. Vaisseaux (Amis ou Ennemis)
      if (occupiedSet.has(key)) return false;

      // 3. Mouvements récemment échoués (Failed Moves)
      if (failedMoves.has(`${vaisseau.idVaisseau},${pos.x},${pos.y}`)) return false;

      // 4. Obstacles statiques (Astéroïdes, Planètes)
      const cell = mapLookup.get(key);
      
      // Si la cellule existe (contient quelque chose), on vérifie si c'est un obstacle
      if (cell) {
        // Note : On autorise le passage sur les planètes (si c'est interdit, le serveur renverra une erreur capturée par failedMoves)
        
        if (cell.type === "ASTEROIDE" || (cell.type && cell.type.nom === "Astéroïde")) return false;
      }
      // Si cell est undefined, c'est du vide, donc c'est TRAVERSABLE (return true par défaut à la fin)

      return true;
    });

    // Trier par distance restante vers la cible (le plus petit est le meilleur)
    validMoves.sort((a, b) => {
      const distA = getDistance(a.x, a.y, cible.x, cible.y);
      const distB = getDistance(b.x, b.y, cible.x, cible.y);
      return distA - distB;
    });

    if (validMoves.length > 0) {
      const bestMove = validMoves[0];
      console.log(`- Déplacement vers ${cible.type} (${cible.x},${cible.y}) -> Go (${bestMove.x},${bestMove.y})`);
      await actionDeplacer(vaisseau.idVaisseau, bestMove.x, bestMove.y);
    } else {
      console.log(`   ⛔ Mouvement impossible : bloqué de tous les côtés.`);
      console.log(`   🔍 Scan des alentours pour debug (${vX},${vY}) :`);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const tx = vX + dx;
          const ty = vY + dy;
          const key = `${tx},${ty}`;
          let status = "✅ LIBRE";

          if (tx < 0 || tx > 57 || ty < 0 || ty > 57) status = "🚫 HORS MAP";
          else if (occupiedSet.has(key)) status = "🚫 OCCUPÉ (Vaisseau/Astéroïde)";
          else if (failedMoves.has(`${vaisseau.idVaisseau},${tx},${ty}`)) status = "🚫 LISTE NOIRE (Erreur précédente)";
          else {
            const c = mapLookup.get(key);
            if (c && (c.type === "ASTEROIDE" || (c.type && c.type.nom === "Astéroïde"))) {
                status = "🚫 ASTEROIDE (Non détecté par occupiedSet)";
            } else if (c && c.planete) {
                status = `⚠️ PLANETE (${c.planete.nom}) - Traversée autorisée`;
            }
          }
          console.log(`      👉 (${tx},${ty}) : ${status}`);
        }
      }
    }
  }
}

async function main() {
  console.log("🚀 Démarrage du script d'attaque...");
  while (true) {
    console.log("\n--- Nouveau tour ---");
    
    // Récupérer la map une seule fois
    const mapCases = await getFullMap();

    // Créer un lookup rapide pour les obstacles statiques (Planètes, Astéroïdes)
    const mapLookup = new Map(mapCases.map(c => [`${c.coord_x},${c.coord_y}`, c]));

    // Utiliser getAllVaisseaux avec la map déjà téléchargée pour trier tout le monde
    const tousLesVaisseaux = await getAllVaisseaux(mapCases);

    // Filtrer mes vaisseaux
    const mesVaisseaux = tousLesVaisseaux.filter(v => MES_VAISSEAUX_IDS.includes(v.idVaisseau));
    
    // Filtrer les ennemis (tous ceux qui ne sont pas dans ma liste d'IDs)
    // On exclut aussi les vaisseaux de la même équipe si nécessaire, mais ici on se base sur les IDs. On exclut aussi l'équipe "PozClope".
    const ennemis = tousLesVaisseaux.filter(v => !MES_VAISSEAUX_IDS.includes(v.idVaisseau) && v.equipe !== 'PozClope' && v.equipe !== 'Sudo Win');
    
    // Construire une carte des obstacles (positions des autres vaisseaux)
    const occupiedSet = new Set();
    tousLesVaisseaux.forEach(v => {
        occupiedSet.add(`${v.coord_x},${v.coord_y}`);
    });
    // Ajouter aussi les astéroïdes si possible (dépend de la structure de mapCases)
    mapCases.forEach(c => {
        // Supposons que c.type contient le type de terrain. Si "Astéroïde" ou autre obstacle :
        if (c.type && (c.type === "ASTEROIDE" || c.type.nom === "Astéroïde")) {
            occupiedSet.add(`${c.coord_x},${c.coord_y}`);
        }
    });

    // Pour le debug, on garde la liste complète
    const tousLesVaisseauxVisibles = tousLesVaisseaux;

    if (mesVaisseaux.length === 0) {
      console.log("⚠️ AUCUN de vos vaisseaux spécifiés n'a été trouvé !");
      console.log("Voici la liste des vaisseaux visibles (copiez les IDs corrects) :");
      tousLesVaisseauxVisibles.forEach(v => {
        console.log(`- ${v.nom} [ID: ${v.idVaisseau}] à (${v.coord_x}, ${v.coord_y})`);
      });
    } else {
      console.log(`✅ ${mesVaisseaux.length} vaisseau(x) prêt(s) à l'action.`);
    }

    // Exécuter la logique pour mes vaisseaux en PARALLÈLE
    await Promise.all(mesVaisseaux.map(v => gererVaisseau(v, mapCases, ennemis, occupiedSet, mapLookup)));

    // --- GESTION INTELLIGENTE DU TEMPS D'ATTENTE ---
    const now = Date.now();
    let allWaiting = true;
    let earliestWakeUp = Infinity;

    // On regarde si au moins un vaisseau est prêt
    for (const v of mesVaisseaux) {
      const cd = cooldowns[v.idVaisseau] || 0;
      if (cd <= now) {
        allWaiting = false; // Un vaisseau est prêt, on boucle vite !
        break;
      }
      if (cd < earliestWakeUp) earliestWakeUp = cd;
    }

    let waitTime = DELAY_MS;
    if (mesVaisseaux.length > 0 && allWaiting && earliestWakeUp !== Infinity) {
      waitTime = Math.max(DELAY_MS, earliestWakeUp - now);
      console.log(`💤 Tous les vaisseaux se reposent. Pause optimisée de ${(waitTime / 1000).toFixed(1)}s...`);
    }

    await new Promise(r => setTimeout(r, waitTime));
  }
}

main();