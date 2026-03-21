async function main() {
  try {
    console.log(`Lancement à ${new Date().toLocaleTimeString("fr-FR")}`);
    const ships = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    console.log(`--- Mes Vaisseaux (${ships.length}) ---`);
    ships.forEach((s, i) => {
      console.log(`[${i}] ${s.nom} (ID: ${s.idVaisseau}) @ ${s.positionX},${s.positionY}`);
    });

    const [cmd, shipRef, x, y] = process.argv.slice(2);

    if (!cmd || !shipRef) {
      console.log("\nUSAGE:");
      console.log("  Déplacer  : node index.js move <index|ID> <x> <y>");
      console.log("  Conquérir : node index.js conquer <index|ID> [x] [y]");
      console.log("  Attaquer  : node index.js attack <index|ID> [x] [y]");
      console.log("  Récolter  : node index.js harvest <index|ID> [x] [y]");
      console.log("  Surveiller: node index.js monitor <ID_PLANETE>");
      return;
    }

    // Récupérer l'ID si l'utilisateur a donné un index (ex: "0")
    let idVaisseau = shipRef;
    let selectedShip = ships.find(s => s.idVaisseau === shipRef);

    if (shipRef.length < 5) {
      const index = parseInt(shipRef);
      if (ships[index]) {
        selectedShip = ships[index];
        idVaisseau = selectedShip.idVaisseau;
      }
    }

    // Coordonnées par défaut = position du vaisseau
    const targetX = x ? Number(x) : selectedShip?.positionX;
    const targetY = y ? Number(y) : selectedShip?.positionY;

    if (cmd === "move") {
      if (!x || !y) {
        console.error("❌ Erreur : Il faut préciser les coordonnées pour un déplacement (x y).");
        return;
      }
      console.log(`\n🚀 Déplacement du vaisseau ${idVaisseau} vers (${targetX}, ${targetY})...`);
      const result = await deplacer(idVaisseau, targetX, targetY);
      console.log("✅ Résultat :", result);
    } else if (cmd === "conquer") {
      console.log(`\n🚩 Tentative de conquête avec le vaisseau ${idVaisseau} en (${targetX}, ${targetY})...`);
      const result = await conquerir(idVaisseau, targetX, targetY);
      console.log("✅ Résultat :", result);
    } else if (cmd === "attack") {
      console.log(`\n⚔️  Attaque avec le vaisseau ${idVaisseau} sur la case (${targetX}, ${targetY})...`);
      const result = await attaquer(idVaisseau, targetX, targetY);
      console.log("✅ Résultat :", result);
    } else if (cmd === "harvest") {
      console.log(`\n⛏️  Récolte avec le vaisseau ${idVaisseau} sur la case (${targetX}, ${targetY})...`);
      const result = await recolter(idVaisseau, targetX, targetY);
      console.log("✅ Résultat :", result);
    } else if (cmd === "auto-attack") {
      let targets = [];
      if (shipRef === "all") {
        targets = ships;
      } else if (selectedShip) {
        targets = [selectedShip];
      } else {
        console.log("❌ Erreur : Pour l'auto-attaque, utilisez 'all' ou un ID/Index valide.");
        return;
      }

      console.log(`\n🔄 Mode auto-attaque activé pour ${targets.length} vaisseau(x). Intervalle : 30s.`);

      while (true) {
        console.log(`\n[${new Date().toLocaleTimeString("fr-FR")}] ⚡ Nouvelle salve d'attaques...`);

        // On rafraichit la liste des vaisseaux pour avoir les positions à jour
        const freshShips = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`).catch(() => targets);

        for (const t of targets) {
          // On retrouve le vaisseau mis à jour (pour la position) ou on garde l'ancien si non trouvé
          const s = freshShips.find(fs => fs.idVaisseau === t.idVaisseau) || t;
          const tx = x ? Number(x) : s.positionX;
          const ty = y ? Number(y) : s.positionY;

          console.log(`   ⚔️  ${s.nom} attaque (${tx}, ${ty})...`);
          try { await attaquer(s.idVaisseau, tx, ty); } catch (e) { console.log(`      ❌ ${e.message}`); }
        }
        await new Promise(r => setTimeout(r, 30000));
      }
    } else if (cmd === "monitor") {
      // "shipRef" contient ici l'ID de la planète passé en argument
      const planetId = shipRef;
      console.log(`\n🔎 Recherche de la planète ${planetId}...`);

      // FIX: On ajoute x_range et y_range car l'API renvoie une erreur 500 (NPE Java) sans ces paramètres
      const map = await apiGet("/monde/map?x_range=0,57&y_range=0,57");
      const target = map.find(c => c.planete && c.planete.identifiant === planetId);

      if (!target) {
        console.error("❌ Planète introuvable sur la carte !");
        return;
      }

      const { coord_x, coord_y, planete } = target;
      console.log(`🎯 Cible trouvée : ${planete.nom} en (${coord_x}, ${coord_y})`);
      console.log("🔄 Lancement du monitoring (Ctrl+C pour arrêter)...");

      while (true) {
        try {
          // On rafraichit uniquement la case spécifique pour économiser des requêtes
          const updates = await apiGet(`/monde/map?x_range=${coord_x},${coord_x}&y_range=${coord_y},${coord_y}`);
          const cell = updates[0];
          if (cell && cell.planete) {
            console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ❤️ PV : ${cell.planete.pointDeVie} \t| 💎 Minerai : ${cell.planete.mineraiDisponible}`);
          } else {
            console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ❌ Planète détruite ou case vide.`);
          }
        } catch (e) { console.log(`   Erreur refresh: ${e.message}`); }
        await new Promise(r => setTimeout(r, 2000)); // Pause de 2 secondes
      }
    } else {
      console.log(`Commande inconnue : ${cmd}`);
    }
  } catch (err) {
    console.error("Erreur :", err.message);
  }
}

main();