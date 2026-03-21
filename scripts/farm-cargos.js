const {
  getMap,
  getShips,
  getTeamState,
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

function printStatus(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function chebyshevDistance(from, to) {
  return Math.max(Math.abs(getX(from) - getX(to)), Math.abs(getY(from) - getY(to)));
}

function samePosition(left, right) {
  return getX(left) === getX(right) && getY(left) === getY(right);
}

function isAdjacent(left, right) {
  return chebyshevDistance(left, right) === 1;
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

function buildCellLookup(cells) {
  const lookup = new Map();

  for (const cell of cells) {
    lookup.set(getCellKey(cell.coord_x, cell.coord_y), cell);
  }

  return lookup;
}

function isPassableCell(cell) {
  if (!cell) {
    return false;
  }

  if (!cell.planete) {
    return true;
  }

  return cell.planete.estVide === true;
}

function isPassableCoord(x, y, cellLookup) {
  const cell = cellLookup.get(getCellKey(x, y));
  return isPassableCell(cell);
}

function isOccupiedCell(x, y, occupiedCells) {
  return occupiedCells.has(getCellKey(x, y));
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

function reserveCell(occupiedCells, cell) {
  occupiedCells.add(getCellKey(cell.x, cell.y));
}

function pickStagingCell(target, otherTarget, occupiedCells = new Set(), cellLookup = null) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      (!cellLookup || isPassableCoord(cell.x, cell.y, cellLookup))
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

function chooseNextStep(ship, target, occupiedCells = new Set(), cellLookup = null) {
  const preferred = nextStepToward(ship, target);

  if (
    !isOccupiedCell(preferred.x, preferred.y, occupiedCells) &&
    (!cellLookup || isPassableCoord(preferred.x, preferred.y, cellLookup))
  ) {
    return preferred;
  }

  const alternatives = buildAdjacentCells(ship).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      (!cellLookup || isPassableCoord(cell.x, cell.y, cellLookup))
  );

  if (alternatives.length === 0) {
    return preferred;
  }

  alternatives.sort((left, right) => {
    const leftScore = chebyshevDistance(left, target);
    const rightScore = chebyshevDistance(right, target);
    return leftScore - rightScore;
  });

  return alternatives[0];
}

function buildLocalRange(ship, radius = 6) {
  return {
    xMin: Math.max(0, getX(ship) - radius),
    xMax: Math.min(57, getX(ship) + radius),
    yMin: Math.max(0, getY(ship) - radius),
    yMax: Math.min(57, getY(ship) + radius)
  };
}

async function getVisibleCellsForShips(cargoShips, radius = 6) {
  const byCoord = new Map();

  for (const ship of cargoShips) {
    const range = buildLocalRange(ship, radius);
    const cells = await getMap(range.xMin, range.xMax, range.yMin, range.yMax);

    for (const cell of cells) {
      byCoord.set(getCellKey(cell.coord_x, cell.coord_y), cell);
    }
  }

  return [...byCoord.values()];
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

function scoreMiningTarget(ship, hub, cell) {
  const shipDistance = chebyshevDistance(ship, cell);
  const hubDistance = chebyshevDistance(hub, cell);
  const minerai = Number(cell.planete?.mineraiDisponible ?? 0);
  const slots = Number(cell.planete?.slotsConstruction ?? 0);

  return minerai - shipDistance * 320 - hubDistance * 120 + slots * 90;
}

function buildMiningCandidates(team, cells, hub) {
  const hubId = hub?.identifiant ?? null;

  return cells.filter((cell) => {
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
}

function assignTargetsToCargos(cargoShips, team, cells) {
  const assignments = new Map();
  const usedTargetKeys = new Set();

  for (const ship of [...cargoShips].sort((left, right) => left.nom.localeCompare(right.nom))) {
    const hub = chooseNearestDepositHub(ship, team);

    if (!hub) {
      continue;
    }

    const candidates = buildMiningCandidates(team, cells, hub)
      .filter((cell) => !usedTargetKeys.has(getCellKey(cell.coord_x, cell.coord_y)))
      .sort((left, right) => {
        const scoreDelta =
          scoreMiningTarget(ship, hub, right) - scoreMiningTarget(ship, hub, left);

        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return chebyshevDistance(ship, left) - chebyshevDistance(ship, right);
      });

    const mine = candidates[0];

    if (!mine) {
      continue;
    }

    usedTargetKeys.add(getCellKey(mine.coord_x, mine.coord_y));
    assignments.set(ship.id, {
      hub,
      mine: {
        identifiant: mine.planete.identifiant,
        nom: mine.planete.nom,
        x: mine.coord_x,
        y: mine.coord_y,
        mineraiDisponible: mine.planete.mineraiDisponible
      }
    });
  }

  return assignments;
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

  if (error.status === 502 || error.message.includes("fetch failed")) {
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

  return (
    error.status === 400 ||
    error.status === 403 ||
    error.status === 423 ||
    error.status === 502 ||
    error.message.includes("fetch failed") ||
    error.message.includes("Aucune cible miniere visible") ||
    error.message.includes("Aucun hub de depot") ||
    error.message.includes("Aucune case libre")
  );
}

async function performCargoStep(ship, plan, occupiedCells, cellLookup) {
  const { hub, mine } = plan;

  if (ship.minerai > 0) {
    const hubStage = pickStagingCell(hub, ship, occupiedCells, cellLookup);

    if (isAdjacent(ship, hub)) {
      printStatus(
        `${ship.nom} depose ${ship.minerai} minerai sur ${hub.nom} (${getX(hub)}, ${getY(hub)})`
      );
      await sendShipAction(ship.id, "DEPOSER", getX(hub), getY(hub));
      return;
    }

    if (!hubStage) {
      throw new Error("Aucune case libre autour du depot pour le moment.");
    }

    const moveTarget = samePosition(ship, hub)
      ? hubStage
      : chooseNextStep(ship, hubStage, occupiedCells, cellLookup);
    reserveCell(occupiedCells, moveTarget);
    printStatus(`${ship.nom} revient vers ${hub.nom}: move (${moveTarget.x}, ${moveTarget.y})`);
    await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
    return;
  }

  if (isAdjacent(ship, mine)) {
    printStatus(`${ship.nom} recolte sur ${mine.nom} (${mine.x}, ${mine.y})`);
    await sendShipAction(ship.id, "RECOLTER", mine.x, mine.y);
    return;
  }

  const mineStage = pickStagingCell(mine, hub, occupiedCells, cellLookup);

  if (!mineStage) {
    throw new Error("Aucune case libre autour de la mine pour le moment.");
  }

  const moveTarget = samePosition(ship, mine)
    ? mineStage
    : chooseNextStep(ship, mineStage, occupiedCells, cellLookup);
  reserveCell(occupiedCells, moveTarget);
  printStatus(`${ship.nom} va vers ${mine.nom}: move (${moveTarget.x}, ${moveTarget.y})`);
  await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
}

async function main() {
  requireConfig();

  const intervalMs = parseNumber(process.argv[2], 5000);
  const assignmentLabels = new Map();

  printStatus("Auto-farm cargos lance.");
  printStatus("Detection automatique de tous les CARGO_* de l'equipe. Ctrl + C pour arreter.");

  while (true) {
    try {
      const [ships, team] = await Promise.all([getShips(), getTeamState()]);
      const cargoShips = ships.filter((ship) => String(ship.classe).includes("CARGO"));

      if (cargoShips.length === 0) {
        throw new Error("Aucun cargo detecte.");
      }

      const cells = await getVisibleCellsForShips(cargoShips, 6);
      const cellLookup = buildCellLookup(cells);
      const assignments = assignTargetsToCargos(cargoShips, team, cells);
      const occupiedCells = new Set(
        ships.map((ship) => getCellKey(getX(ship), getY(ship)))
      );

      for (const cargo of cargoShips.sort((left, right) => left.nom.localeCompare(right.nom))) {
        const plan = assignments.get(cargo.id);

        if (!plan) {
          printStatus(`${cargo.nom} n'a pas de cible miniere visible pour le moment.`);
          continue;
        }

        const label = `${plan.mine.nom}:${plan.mine.x},${plan.mine.y}|${plan.hub.nom}:${getX(plan.hub)},${getY(plan.hub)}`;

        if (assignmentLabels.get(cargo.id) !== label) {
          assignmentLabels.set(cargo.id, label);
          printStatus(
            `${cargo.nom} cible ${plan.mine.nom} (${plan.mine.x}, ${plan.mine.y}) -> depot ${plan.hub.nom} (${getX(plan.hub)}, ${getY(plan.hub)})`
          );
        }

        if (cargo.cooldown > 0) {
          printStatus(
            `${cargo.nom} attend cooldown ${cargo.cooldown} en (${getX(cargo)}, ${getY(cargo)})`
          );
          continue;
        }

        occupiedCells.delete(getCellKey(getX(cargo), getY(cargo)));

        try {
          await performCargoStep(cargo, plan, occupiedCells, cellLookup);
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          printStatus(`${cargo.nom} reporte son action: ${error.message}`);
        }
      }

      await sleep(intervalMs);
    } catch (error) {
      if (!isRecoverableError(error)) {
        throw error;
      }

      const retryDelay = getRetryDelay(error, intervalMs);
      printStatus(
        `Boucle cargo reportee: ${error.message}. Nouvelle tentative dans ${Math.ceil(
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
