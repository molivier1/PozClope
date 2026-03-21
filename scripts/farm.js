const {
  getMap,
  getShips,
  getTeamState,
  normalizeText,
  requireConfig,
  sendShipAction
} = require("./game");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getX(entity) {
  return Number(entity?.x ?? entity?.coord_x);
}

function getY(entity) {
  return Number(entity?.y ?? entity?.coord_y);
}

function getCellKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildLocalRange(ship, radius = 6) {
  return {
    xMin: Math.max(0, getX(ship) - radius),
    xMax: Math.min(57, getX(ship) + radius),
    yMin: Math.max(0, getY(ship) - radius),
    yMax: Math.min(57, getY(ship) + radius)
  };
}

function samePosition(a, b) {
  return getX(a) === getX(b) && getY(a) === getY(b);
}

function isAdjacent(ship, target) {
  const dx = Math.abs(getX(ship) - getX(target));
  const dy = Math.abs(getY(ship) - getY(target));
  return Math.max(dx, dy) === 1;
}

function nextStepToward(ship, target) {
  return {
    x: getX(ship) + Math.sign(getX(target) - getX(ship)),
    y: getY(ship) + Math.sign(getY(target) - getY(ship))
  };
}

function buildAdjacentCells(target) {
  const cells = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      cells.push({ x: getX(target) + dx, y: getY(target) + dy });
    }
  }

  return cells;
}

function buildOccupiedCells(ships, ignoredShipId) {
  const occupied = new Set();

  for (const ship of ships) {
    if (ship.id === ignoredShipId) {
      continue;
    }

    occupied.add(getCellKey(getX(ship), getY(ship)));
  }

  return occupied;
}

function isOccupiedCell(x, y, occupiedCells) {
  return occupiedCells.has(getCellKey(x, y));
}

function pickStagingCell(target, otherTarget, occupiedCells = new Set()) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) => !isOccupiedCell(cell.x, cell.y, occupiedCells)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftScore =
      Math.abs(left.x - getX(otherTarget)) + Math.abs(left.y - getY(otherTarget));
    const rightScore =
      Math.abs(right.x - getX(otherTarget)) + Math.abs(right.y - getY(otherTarget));
    return leftScore - rightScore;
  });

  return candidates[0];
}

function chooseNextStep(ship, target, occupiedCells = new Set()) {
  const preferred = nextStepToward(ship, target);

  if (!isOccupiedCell(preferred.x, preferred.y, occupiedCells)) {
    return preferred;
  }

  const alternatives = buildAdjacentCells(ship).filter(
    (cell) => !isOccupiedCell(cell.x, cell.y, occupiedCells)
  );

  if (alternatives.length === 0) {
    return preferred;
  }

  alternatives.sort((left, right) => {
    const leftScore =
      Math.max(Math.abs(left.x - getX(target)), Math.abs(left.y - getY(target)));
    const rightScore =
      Math.max(Math.abs(right.x - getX(target)), Math.abs(right.y - getY(target)));
    return leftScore - rightScore;
  });

  return alternatives[0];
}

function findShipByName(ships, name) {
  const wanted = normalizeText(name);
  return ships.find((ship) => normalizeText(ship.nom) === wanted);
}

function printStatus(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function chebyshevDistance(from, to) {
  return Math.max(Math.abs(getX(from) - getX(to)), Math.abs(getY(from) - getY(to)));
}

function isFiniteCoord(value) {
  return Number.isFinite(Number(value));
}

function chooseNearestDepositHub(ship, team) {
  const hubs = team.planetes.filter((planet) =>
    planet.modules.some((module) => module.typeModule === "DECHARGEMENT_RESSOURCE")
  );

  if (hubs.length === 0) {
    return null;
  }

  return hubs.sort(
    (left, right) => chebyshevDistance(ship, left) - chebyshevDistance(ship, right)
  )[0];
}

function chooseNearestMiningTarget(ship, team, cells, hub) {
  const ownedPlanetIds = new Set(team.planetes.map((planet) => planet.identifiant).filter(Boolean));
  const hubId = hub?.identifiant ?? null;
  const candidates = cells.filter((cell) => {
    if (!cell.planete || cell.planete.estVide || cell.planete.mineraiDisponible <= 0) {
      return false;
    }

    if (cell.planete.identifiant && cell.planete.identifiant === hubId) {
      return false;
    }

    if (
      cell.proprietaire?.identifiant &&
      cell.proprietaire.identifiant !== team.identifiant
    ) {
      return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const distanceDelta = chebyshevDistance(ship, left) - chebyshevDistance(ship, right);

    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    const mineralDelta =
      Number(right.planete.mineraiDisponible) - Number(left.planete.mineraiDisponible);

    if (mineralDelta !== 0) {
      return mineralDelta;
    }

    const leftOwned = ownedPlanetIds.has(left.planete.identifiant);
    const rightOwned = ownedPlanetIds.has(right.planete.identifiant);

    if (leftOwned !== rightOwned) {
      return leftOwned ? 1 : -1;
    }

    return (right.planete.slotsConstruction ?? 0) - (left.planete.slotsConstruction ?? 0);
  });

  return {
    identifiant: candidates[0].planete.identifiant,
    nom: candidates[0].planete.nom,
    x: candidates[0].coord_x,
    y: candidates[0].coord_y,
    mineraiDisponible: candidates[0].planete.mineraiDisponible
  };
}

function parseAvailabilityDate(error) {
  const match = error.message.match(/(\d{2}):(\d{2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  const now = new Date();
  const target = new Date(now);

  target.setHours(Number(hours), Number(minutes), Number(seconds), 0);

  if (target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

function getRetryDelay(error, intervalMs) {
  const availabilityDate = parseAvailabilityDate(error);

  if (availabilityDate) {
    return Math.max(availabilityDate.getTime() - Date.now() + 1000, 1000);
  }

  if (error.status === 423) {
    return Math.max(intervalMs, 5000);
  }

  if (error.message.includes("fetch failed")) {
    return Math.max(intervalMs, 10000);
  }

  return intervalMs;
}

function isRecoverableError(error) {
  if (!error) {
    return false;
  }

  if (error.status === 401) {
    return false;
  }

  if (error.status === 400 || error.status === 403 || error.status === 423) {
    return true;
  }

  if (error.message.includes("fetch failed")) {
    return true;
  }

  if (error.message.includes("prochaine disponibilite")) {
    return true;
  }

  if (error.message.includes("Aucune cible miniere visible")) {
    return true;
  }

  if (error.message.includes("Aucun hub de depot")) {
    return true;
  }

  if (error.message.includes("Aucune case libre")) {
    return true;
  }

  return false;
}

async function main() {
  requireConfig();

  const shipName = process.argv[2] || "Chasseur leger 0";
  const hasManualTargets =
    isFiniteCoord(process.argv[3]) &&
    isFiniteCoord(process.argv[4]) &&
    isFiniteCoord(process.argv[5]) &&
    isFiniteCoord(process.argv[6]);
  const manualMine = hasManualTargets
    ? { x: Number(process.argv[3]), y: Number(process.argv[4]) }
    : null;
  const manualHub = hasManualTargets
    ? { x: Number(process.argv[5]), y: Number(process.argv[6]) }
    : null;
  const intervalMs = parseNumber(process.argv[hasManualTargets ? 7 : 3], 5000);
  let lastTargetLabel = null;

  printStatus(
    hasManualTargets
      ? `Auto-farm lance pour ${shipName} | mine (${manualMine.x}, ${manualMine.y}) | depot (${manualHub.x}, ${manualHub.y})`
      : `Auto-farm autonome lance pour ${shipName} | cibles choisies automatiquement`
  );
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    try {
      const [ships, team] = await Promise.all([getShips(), getTeamState()]);
      const ship = findShipByName(ships, shipName);

      if (!ship) {
        throw new Error(`Vaisseau introuvable: ${shipName}`);
      }

      const occupiedCells = buildOccupiedCells(ships, ship.id);

      const hub = manualHub || chooseNearestDepositHub(ship, team);

      if (!hub) {
        throw new Error("Aucun hub de depot avec DECHARGEMENT_RESSOURCE trouve.");
      }

      if (ship.cooldown > 0) {
        printStatus(
          `${ship.nom} attend cooldown ${ship.cooldown} en (${getX(ship)}, ${getY(ship)})`
        );
        await sleep(intervalMs);
        continue;
      }

      if (ship.minerai > 0) {
        const hubStage = pickStagingCell(hub, ship, occupiedCells);

        if (isAdjacent(ship, hub)) {
          printStatus(
            `${ship.nom} depose ${ship.minerai} minerai sur (${getX(hub)}, ${getY(hub)})`
          );
          await sendShipAction(ship.id, "DEPOSER", getX(hub), getY(hub));
        } else {
          if (!hubStage) {
            throw new Error("Aucune case libre autour du depot pour le moment.");
          }

          const moveTarget = samePosition(ship, hub)
            ? hubStage
            : chooseNextStep(ship, hubStage, occupiedCells);
          printStatus(
            `${ship.nom} revient vers le depot: move (${moveTarget.x}, ${moveTarget.y})`
          );
          await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        }
      } else {
        const scan = hasManualTargets
          ? null
          : buildLocalRange(ship, 6);
        const cells = hasManualTargets
          ? null
          : await getMap(scan.xMin, scan.xMax, scan.yMin, scan.yMax);
        const mine = manualMine || chooseNearestMiningTarget(ship, team, cells, hub);

        if (!mine) {
          throw new Error("Aucune cible miniere visible pour le moment.");
        }

        const targetLabel = `${mine.x},${mine.y}|${getX(hub)},${getY(hub)}`;

        if (targetLabel !== lastTargetLabel) {
          printStatus(
            `Cible active: mine ${mine.nom || "inconnue"} (${mine.x}, ${mine.y}) -> depot ${hub.nom || "hub"} (${getX(hub)}, ${getY(hub)})`
          );
          lastTargetLabel = targetLabel;
        }

        if (isAdjacent(ship, mine)) {
          printStatus(`${ship.nom} recolte sur (${mine.x}, ${mine.y})`);
          await sendShipAction(ship.id, "RECOLTER", mine.x, mine.y);
        } else {
          const mineStage = pickStagingCell(mine, hub, occupiedCells);

          if (!mineStage) {
            throw new Error("Aucune case libre autour de la mine pour le moment.");
          }

          const moveTarget = samePosition(ship, mine)
            ? mineStage
            : chooseNextStep(ship, mineStage, occupiedCells);
          printStatus(
            `${ship.nom} avance vers la mine: move (${moveTarget.x}, ${moveTarget.y})`
          );
          await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        }
      }

      await sleep(intervalMs);
    } catch (error) {
      if (!isRecoverableError(error)) {
        throw error;
      }

      const retryDelay = getRetryDelay(error, intervalMs);
      printStatus(
        `Action reportee: ${error.message}. Nouvelle tentative dans ${Math.ceil(
          retryDelay / 1000
        )}s`
      );
      await sleep(retryDelay);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
