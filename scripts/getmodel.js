const {
  getMap,
  getMarketOffers,
  getPlans,
  getShips,
  getTeam,
  requireConfig
} = require("./game");

function extractArray(payload) {
  return Array.isArray(payload) ? payload : [];
}

function getResourceName(entry) {
  return entry?.ressource?.nom ?? entry?.nom ?? "INCONNU";
}

function getResourceQuantity(entry) {
  return Number(entry?.quantite ?? entry?.valeur ?? 0);
}

function formatCoord(x, y) {
  return `(${x}, ${y})`;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function normalizeShipType(type) {
  if (!type) {
    return null;
  }

  return {
    id: type.id ?? null,
    nom: type.nom ?? null,
    classe: type.classeVaisseau ?? null,
    coutConstruction: Number(type.coutConstruction ?? 0),
    capaciteTransport: Number(type.capaciteTransport ?? 0),
    attaque: Number(type.attaque ?? 0),
    pointDeVie: Number(type.pointDeVie ?? 0),
    vitesse: Number(type.vitesse ?? 0)
  };
}

function summarizeResources(team) {
  return extractArray(team?.ressources)
    .map((entry) => ({
      nom: getResourceName(entry),
      quantite: getResourceQuantity(entry)
    }))
    .sort((left, right) => left.nom.localeCompare(right.nom));
}

function summarizeShips(ships) {
  return extractArray(ships).map((ship) => ({
    id: ship.idVaisseau ?? ship.id ?? ship.identifiant ?? null,
    nom: ship.nom ?? "Sans nom",
    classe:
      ship.classeVaisseau ??
      ship.classe ??
      ship.type?.classeVaisseau ??
      ship.modeleVaisseau?.classeVaisseau ??
      null,
    typeId:
      ship.typeId ??
      ship.type?.id ??
      ship.modeleVaisseau?.id ??
      null,
    typeNom:
      ship.typeNom ??
      ship.type?.nom ??
      ship.modeleVaisseau?.nom ??
      null,
    coord_x: Number(ship.positionX ?? ship.coord_x ?? 0),
    coord_y: Number(ship.positionY ?? ship.coord_y ?? 0),
    minerai: Number(ship.mineraiTransporte ?? ship.minerai ?? 0),
    cooldown:
      ship.cooldown ??
      ship.dateProchaineAction ??
      0
  }));
}

function summarizeOwnedPlanets(team) {
  return extractArray(team?.planetes).map((planet) => ({
    id: planet.identifiant ?? planet.id ?? null,
    nom: planet.nom,
    coord_x: Number(planet.coord_x ?? 0),
    coord_y: Number(planet.coord_y ?? 0),
    slotsConstruction: Number(planet.slotsConstruction ?? 0),
    pointDeVie: Number(planet.pointDeVie ?? 0),
    modules: extractArray(planet.modules).map((module) => ({
      id: module.id ?? null,
      typeModule: module.paramModule?.typeModule ?? module.typeModule ?? null,
      constructibles: extractArray(module.paramModule?.listeVaisseauxConstructible).map(
        (type) => ({
          id: type.id ?? null,
          classe: type.classeVaisseau ?? null
        })
      )
    }))
  }));
}

function summarizePlans(plans) {
  return extractArray(plans).map((plan) => ({
    id: plan.id ?? null,
    nom: plan.nom ?? null,
    type: normalizeShipType(plan.typeVaisseau)
  }));
}

function extractConstructibleTypes(planets) {
  const types = [];

  for (const planet of planets) {
    for (const module of planet.modules) {
      for (const type of module.constructibles) {
        types.push({
          chantierTypeId: type.id,
          classe: type.classe,
          planeteNom: planet.nom,
          planeteId: planet.id
        });
      }
    }
  }

  return types;
}

function summarizeMarket(offers) {
  const cheapestPlansByClass = new Map();
  const cheapestModulesByType = new Map();

  for (const offer of extractArray(offers)) {
    const plan =
      offer.planVaisseau ?? offer.plan ?? offer.objet?.planVaisseau ?? offer.objet?.plan;
    const module = offer.module ?? offer.objet?.module ?? null;

    if (plan?.typeVaisseau?.classeVaisseau) {
      const type = normalizeShipType(plan.typeVaisseau);
      const key = type.classe;
      const current = cheapestPlansByClass.get(key);

      if (!current || Number(offer.prix ?? 0) < current.prix) {
        cheapestPlansByClass.set(key, {
          offreId: offer.idOffre ?? offer.id ?? null,
          prix: Number(offer.prix ?? 0),
          planNom: plan.nom ?? null,
          type
        });
      }
    }

    if (module?.paramModule?.typeModule) {
      const key = module.paramModule.typeModule;
      const current = cheapestModulesByType.get(key);

      if (!current || Number(offer.prix ?? 0) < current.prix) {
        cheapestModulesByType.set(key, {
          offreId: offer.idOffre ?? offer.id ?? null,
          prix: Number(offer.prix ?? 0),
          typeModule: key,
          nombreSlotsOccupes: Number(module.paramModule.nombreSlotsOccupes ?? 0)
        });
      }
    }
  }

  return {
    plans: [...cheapestPlansByClass.values()].sort((left, right) =>
      left.type.classe.localeCompare(right.type.classe)
    ),
    modules: [...cheapestModulesByType.values()].sort((left, right) =>
      left.typeModule.localeCompare(right.typeModule)
    )
  };
}

function buildSuggestedRange(ships, padding = 6) {
  const xs = ships.map((ship) => ship.coord_x);
  const ys = ships.map((ship) => ship.coord_y);

  return {
    xMin: Math.max(0, Math.min(...xs) - padding),
    xMax: Math.min(57, Math.max(...xs) + padding),
    yMin: Math.max(0, Math.min(...ys) - padding),
    yMax: Math.min(57, Math.max(...ys) + padding)
  };
}

function summarizeVisibleTargets(cells, ships) {
  return extractArray(cells)
    .filter((cell) => cell.planete && !cell.planete.estVide && cell.planete.mineraiDisponible > 0)
    .map((cell) => {
      const distances = ships.map((ship) =>
        Math.max(Math.abs(ship.coord_x - cell.coord_x), Math.abs(ship.coord_y - cell.coord_y))
      );

      return {
        nom: cell.planete.nom,
        coord_x: cell.coord_x,
        coord_y: cell.coord_y,
        minerai: Number(cell.planete.mineraiDisponible ?? 0),
        slotsConstruction: Number(cell.planete.slotsConstruction ?? 0),
        proprietaire: cell.proprietaire?.nom ?? null,
        distanceFlotte: distances.length ? Math.min(...distances) : null
      };
    })
    .sort((left, right) => {
      const byMinerai = right.minerai - left.minerai;

      if (byMinerai !== 0) {
        return byMinerai;
      }

      return (left.distanceFlotte ?? 999) - (right.distanceFlotte ?? 999);
    });
}

function printResources(resources) {
  printSection("Ressources");

  for (const resource of resources) {
    console.log(`- ${resource.nom}: ${resource.quantite}`);
  }
}

function printShips(ships) {
  printSection("Vaisseaux");

  for (const ship of ships) {
    console.log(
      `- ${ship.nom} | ${ship.classe || "INCONNU"} | ${formatCoord(
        ship.coord_x,
        ship.coord_y
      )} | minerai ${ship.minerai} | cooldown ${ship.cooldown} | id ${ship.id}`
    );
  }
}

function printOwnedPlanets(planets) {
  printSection("Planetes");

  for (const planet of planets) {
    console.log(
      `- ${planet.nom} | ${formatCoord(planet.coord_x, planet.coord_y)} | slots ${planet.slotsConstruction} | pv ${planet.pointDeVie}`
    );

    for (const module of planet.modules) {
      const extra =
        module.constructibles.length > 0
          ? ` | construit ${module.constructibles.map((item) => item.classe).join(", ")}`
          : "";
      console.log(`  ${module.typeModule}${extra}`);
    }
  }
}

function printPlans(plans) {
  printSection("Plans Possedes");

  if (plans.length === 0) {
    console.log("- Aucun");
    return;
  }

  for (const plan of plans) {
    console.log(
      `- ${plan.nom} | ${plan.type?.classe || "INCONNU"} | typeId ${plan.type?.id || "?"} | cout ${plan.type?.coutConstruction || 0}`
    );
  }
}

function printConstructibles(constructibles, marketSummary) {
  printSection("Constructibles");

  for (const item of constructibles) {
    const marketType = marketSummary.plans.find((plan) => plan.type.classe === item.classe);
    const extra = marketType
      ? ` | typeId reel ${marketType.type.id} | cout ${marketType.type.coutConstruction}`
      : "";
    console.log(`- ${item.classe} | base ${item.planeteNom}${extra}`);
  }
}

function printMarket(marketSummary) {
  printSection("Marche / Plans");

  for (const offer of marketSummary.plans) {
    console.log(
      `- ${offer.type.classe} | offre ${offer.offreId} | prix ${offer.prix} | typeId ${offer.type.id} | cout construction ${offer.type.coutConstruction}`
    );
  }

  printSection("Marche / Modules");

  for (const offer of marketSummary.modules) {
    console.log(
      `- ${offer.typeModule} | offre ${offer.offreId} | prix ${offer.prix} | slots ${offer.nombreSlotsOccupes}`
    );
  }
}

function printVisibleTargets(targets, range) {
  printSection("Cibles Visibles");
  console.log(`- Range scannee: x=${range.xMin}-${range.xMax} y=${range.yMin}-${range.yMax}`);

  if (targets.length === 0) {
    console.log("- Aucune cible visible dans la zone scannee");
    return;
  }

  for (const target of targets.slice(0, 20)) {
    console.log(
      `- ${target.nom} | ${formatCoord(target.coord_x, target.coord_y)} | minerai ${target.minerai} | slots ${target.slotsConstruction} | distance flotte ${target.distanceFlotte} | proprio ${target.proprietaire || "aucun"}`
    );
  }
}

async function main() {
  requireConfig();

  const outputJson = process.argv.includes("--json");
  const [team, plans, ships, marketOffers] = await Promise.all([
    getTeam(),
    getPlans(),
    getShips(),
    getMarketOffers()
  ]);

  const shipSummary = summarizeShips(ships);
  const resourceSummary = summarizeResources(team);
  const planetSummary = summarizeOwnedPlanets(team);
  const planSummary = summarizePlans(plans);
  const constructibleSummary = extractConstructibleTypes(planetSummary);
  const marketSummary = summarizeMarket(marketOffers);
  const range = buildSuggestedRange(shipSummary, 6);
  const cells = await getMap(range.xMin, range.xMax, range.yMin, range.yMax);
  const visibleTargets = summarizeVisibleTargets(cells, shipSummary);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    resources: resourceSummary,
    ships: shipSummary,
    planets: planetSummary,
    ownedPlans: planSummary,
    constructible: constructibleSummary,
    market: marketSummary,
    visibleTargets,
    scannedRange: range
  };

  if (outputJson) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  printResources(resourceSummary);
  printShips(shipSummary);
  printOwnedPlanets(planetSummary);
  printPlans(planSummary);
  printConstructibles(constructibleSummary, marketSummary);
  printMarket(marketSummary);
  printVisibleTargets(visibleTargets, range);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
