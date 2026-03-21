const fs = require("fs");
const path = require("path");

const {
  getMap,
  getShips,
  getTeamState,
  requireConfig,
  sendShipAction
} = require("./game");

const LOCK_FILE = path.join(__dirname, ".farm-cargos.lock");

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

function parseAvailabilityDate(error) {
  const match = String(error?.message ?? "").match(/(\d{2}):(\d{2}):(\d{2})/);

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

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      return;
    }

    const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));

    if (current?.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Verrou best-effort uniquement.
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));

      if (current?.pid && current.pid !== process.pid && isProcessAlive(current.pid)) {
        throw new Error(
          `farm-cargos est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("farm-cargos est deja lance")) {
        throw error;
      }
    }
  }

  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function shouldManageCargo(ship, includeLightCargos = false) {
  const shipClass = String(ship?.classe ?? "");

  if (!shipClass.includes("CARGO")) {
    return false;
  }

  if (includeLightCargos) {
    return true;
  }

  return shipClass !== "CARGO_LEGER";
}

function printStatus(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function getShipLabel(ship) {
  const shortId = String(ship?.id ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6);

  return shortId ? `${ship.nom} [${shortId}]` : ship.nom;
}

function getPreferredMineRadius(ship) {
  const override = parseNumber(process.env.FARM_MAX_MINE_DISTANCE, NaN);

  if (Number.isFinite(override) && override > 0) {
    return override;
  }

  const shipClass = String(ship?.classe ?? "");

  if (shipClass === "CARGO_LEGER") {
    return 6;
  }

  if (shipClass === "CARGO_MOYEN") {
    return 8;
  }

  if (shipClass === "CARGO_LOURD") {
    return 10;
  }

  return 8;
}

function getWaitBucket(remainingMs) {
  const seconds = Math.ceil(Math.max(remainingMs, 0) / 1000);

  if (seconds <= 3) {
    return seconds;
  }

  return Math.ceil(seconds / 5) * 5;
}

function getShipReadyDelay(ship) {
  const cooldown = ship?.cooldown;

  if (cooldown === null || cooldown === undefined || cooldown === 0 || cooldown === "0") {
    return 0;
  }

  if (typeof cooldown === "number" && Number.isFinite(cooldown)) {
    return cooldown > 0 ? cooldown * 1000 : 0;
  }

  const parsed = new Date(cooldown);

  if (Number.isFinite(parsed.getTime())) {
    return Math.max(parsed.getTime() - Date.now(), 0);
  }

  return 0;
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

function reserveTemporarilyBlockedCells(occupiedCells, temporaryBlockedCells) {
  const now = Date.now();

  for (const [key, blockedUntil] of temporaryBlockedCells.entries()) {
    if (blockedUntil <= now) {
      temporaryBlockedCells.delete(key);
      continue;
    }

    occupiedCells.add(key);
  }
}

function markCellTemporarilyBlocked(temporaryBlockedCells, cell, durationMs = 20000) {
  temporaryBlockedCells.set(getCellKey(cell.x, cell.y), Date.now() + durationMs);
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
  const roundTripDistance = shipDistance + hubDistance;
  const minerai = Number(cell.planete?.mineraiDisponible ?? 0);
  const slots = Number(cell.planete?.slotsConstruction ?? 0);

  return minerai - roundTripDistance * 260 - shipDistance * 180 + slots * 60;
}

function buildMiningCandidates(team, cells, hub, ship = null) {
  const hubId = hub?.identifiant ?? null;
  const maxMineRadius = ship ? getPreferredMineRadius(ship) : null;

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

    if (Number.isFinite(maxMineRadius) && chebyshevDistance(hub, cell) > maxMineRadius) {
      return false;
    }

    return true;
  });
}

function findHubByPlan(team, plan) {
  if (!plan?.hub) {
    return null;
  }

  return (
    team.planetes.find((planet) => planet.identifiant === plan.hub.identifiant) ??
    team.planetes.find(
      (planet) =>
        planet.nom === plan.hub.nom &&
        getX(planet) === getX(plan.hub) &&
        getY(planet) === getY(plan.hub)
    ) ??
    null
  );
}

function findMineCellByPlan(cells, plan) {
  if (!plan?.mine) {
    return null;
  }

  return (
    cells.find((cell) => cell.planete?.identifiant && cell.planete.identifiant === plan.mine.identifiant) ??
    cells.find(
      (cell) =>
        getX(cell) === getX(plan.mine) &&
        getY(cell) === getY(plan.mine) &&
        cell.planete?.nom === plan.mine.nom
    ) ??
    null
  );
}

function buildPlanFromMineCell(hub, mine) {
  return {
    hub,
    mine: {
      identifiant: mine.planete.identifiant,
      nom: mine.planete.nom,
      x: mine.coord_x,
      y: mine.coord_y,
      mineraiDisponible: mine.planete.mineraiDisponible
    }
  };
}

function isVisibleMineStillValid(team, mineCell, hub) {
  return buildMiningCandidates(team, [mineCell], hub).length > 0;
}

function keepPreviousPlan(ship, team, cells, previousPlan) {
  if (!previousPlan) {
    return null;
  }

  const hub = findHubByPlan(team, previousPlan) ?? chooseNearestDepositHub(ship, team);

  if (!hub) {
    return null;
  }

  if (ship.minerai > 0) {
    return {
      hub,
      mine: previousPlan.mine
    };
  }

  const visibleMine = findMineCellByPlan(cells, previousPlan);

  if (!visibleMine) {
    return {
      hub,
      mine: previousPlan.mine
    };
  }

  if (!isVisibleMineStillValid(team, visibleMine, hub)) {
    return null;
  }

  return buildPlanFromMineCell(hub, visibleMine);
}

function assignTargetsToCargos(cargoShips, team, cells, previousAssignments = new Map()) {
  const assignments = new Map();
  const usedTargetKeys = new Set();

  const sortedShips = [...cargoShips].sort((left, right) => left.nom.localeCompare(right.nom));

  for (const ship of sortedShips) {
    const previousPlan = keepPreviousPlan(ship, team, cells, previousAssignments.get(ship.id));

    if (!previousPlan) {
      continue;
    }

    const mineKey = getCellKey(previousPlan.mine.x, previousPlan.mine.y);

    if (usedTargetKeys.has(mineKey)) {
      continue;
    }

    usedTargetKeys.add(mineKey);
    assignments.set(ship.id, previousPlan);
  }

  for (const ship of sortedShips) {
    if (assignments.has(ship.id)) {
      continue;
    }

    const hub = chooseNearestDepositHub(ship, team);

    if (!hub) {
      continue;
    }

    let candidates = buildMiningCandidates(team, cells, hub, ship)
      .filter((cell) => !usedTargetKeys.has(getCellKey(cell.coord_x, cell.coord_y)))
      .sort((left, right) => {
        const scoreDelta =
          scoreMiningTarget(ship, hub, right) - scoreMiningTarget(ship, hub, left);

        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return chebyshevDistance(ship, left) - chebyshevDistance(ship, right);
      });

    if (candidates.length === 0) {
      candidates = buildMiningCandidates(team, cells, hub)
        .filter((cell) => !usedTargetKeys.has(getCellKey(cell.coord_x, cell.coord_y)))
        .sort((left, right) => {
          const scoreDelta =
            scoreMiningTarget(ship, hub, right) - scoreMiningTarget(ship, hub, left);

          if (scoreDelta !== 0) {
            return scoreDelta;
          }

          return chebyshevDistance(ship, left) - chebyshevDistance(ship, right);
        });
    }

    const mine = candidates[0];

    if (!mine) {
      continue;
    }

    usedTargetKeys.add(getCellKey(mine.coord_x, mine.coord_y));
    assignments.set(ship.id, buildPlanFromMineCell(hub, mine));
  }

  return assignments;
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

function isOccupiedTargetError(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes("Case cible déjà occupée") ||
    message.includes("Case cible deja occupee") ||
    message.includes("Case cible dÃ©jÃ  occupÃ©e")
  );
}

async function performCargoStep(ship, plan, occupiedCells, cellLookup, temporaryBlockedCells) {
  const { hub, mine } = plan;
  const shipLabel = getShipLabel(ship);

  if (ship.minerai > 0) {
    const hubStage = pickStagingCell(hub, ship, occupiedCells, cellLookup);

    if (isAdjacent(ship, hub)) {
      printStatus(
        `${shipLabel} depose ${ship.minerai} minerai sur ${hub.nom} (${getX(hub)}, ${getY(hub)})`
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
    printStatus(`${shipLabel} revient vers ${hub.nom}: move (${moveTarget.x}, ${moveTarget.y})`);
    try {
      await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
    } catch (error) {
      if (!isOccupiedTargetError(error)) {
        throw error;
      }

      markCellTemporarilyBlocked(temporaryBlockedCells, moveTarget);
      throw error;
    }
    return;
  }

  if (isAdjacent(ship, mine)) {
    printStatus(`${shipLabel} recolte sur ${mine.nom} (${mine.x}, ${mine.y})`);
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
  printStatus(`${shipLabel} va vers ${mine.nom}: move (${moveTarget.x}, ${moveTarget.y})`);
  try {
    await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
  } catch (error) {
    if (!isOccupiedTargetError(error)) {
      throw error;
    }

    markCellTemporarilyBlocked(temporaryBlockedCells, moveTarget);
    throw error;
  }
}

async function main() {
  requireConfig();
  acquireLock();

  const intervalMs = parseNumber(process.argv[2], 5000);
  const includeLightCargos = process.env.FARM_INCLUDE_LIGHT === "1";
  const assignmentLabels = new Map();
  const assignmentMemory = new Map();
  const temporaryBlockedCells = new Map();
  const waitLogBuckets = new Map();

  printStatus("Auto-farm cargos lance.");
  printStatus(
    includeLightCargos
      ? "Detection automatique de tous les CARGO_* de l'equipe. Ctrl + C pour arreter."
      : "Detection automatique des CARGO_MOYEN et CARGO_LOURD. Les CARGO_LEGER restent immobiles."
  );

  while (true) {
    try {
      const [ships, team] = await Promise.all([getShips(), getTeamState()]);
      const cargoShips = ships.filter((ship) => shouldManageCargo(ship, includeLightCargos));

      if (cargoShips.length === 0) {
        throw new Error(
          includeLightCargos
            ? "Aucun cargo detecte."
            : "Aucun cargo moyen/lourd detecte."
        );
      }

      const cells = await getVisibleCellsForShips(cargoShips, 6);
      const cellLookup = buildCellLookup(cells);
      const assignments = assignTargetsToCargos(cargoShips, team, cells, assignmentMemory);
      const occupiedCells = new Set(
        ships.map((ship) => getCellKey(getX(ship), getY(ship)))
      );
      reserveTemporarilyBlockedCells(occupiedCells, temporaryBlockedCells);

      for (const ship of cargoShips) {
        if (assignments.has(ship.id)) {
          assignmentMemory.set(ship.id, assignments.get(ship.id));
          continue;
        }

        assignmentMemory.delete(ship.id);
      }

      for (const cargo of cargoShips.sort((left, right) => left.nom.localeCompare(right.nom))) {
        const plan = assignments.get(cargo.id);
        const cargoLabel = getShipLabel(cargo);

        if (!plan) {
          printStatus(`${cargoLabel} n'a pas de cible miniere visible pour le moment.`);
          continue;
        }

        const label = `${plan.mine.nom}:${plan.mine.x},${plan.mine.y}|${plan.hub.nom}:${getX(plan.hub)},${getY(plan.hub)}`;

        if (assignmentLabels.get(cargo.id) !== label) {
          assignmentLabels.set(cargo.id, label);
          printStatus(
            `${cargoLabel} cible ${plan.mine.nom} (${plan.mine.x}, ${plan.mine.y}) -> depot ${plan.hub.nom} (${getX(plan.hub)}, ${getY(plan.hub)})`
          );
        }

        const readyDelay = getShipReadyDelay(cargo);

        if (readyDelay > 0) {
          const waitBucket = getWaitBucket(readyDelay);

          if (waitLogBuckets.get(cargo.id) !== waitBucket) {
            waitLogBuckets.set(cargo.id, waitBucket);
            printStatus(
              `${cargoLabel} attend encore ${Math.ceil(readyDelay / 1000)}s en (${getX(cargo)}, ${getY(cargo)})`
            );
          }
          continue;
        }

        waitLogBuckets.delete(cargo.id);

        occupiedCells.delete(getCellKey(getX(cargo), getY(cargo)));

        try {
          await performCargoStep(cargo, plan, occupiedCells, cellLookup, temporaryBlockedCells);
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          printStatus(`${cargoLabel} reporte son action: ${error.message}`);
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

process.on("exit", releaseLock);
process.on("SIGINT", () => {
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseLock();
  process.exit(0);
});

main().catch((error) => {
  releaseLock();
  console.error(error.message);
  process.exit(1);
});
