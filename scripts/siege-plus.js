const fs = require("fs");
const path = require("path");

const {
  getMap,
  getShips,
  getTeamState,
  normalizeText,
  requireConfig,
  sendShipAction
} = require("./game");

const MAP_SIZE = 58;
const LOCK_FILE = path.join(__dirname, ".siege-plus.lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
          `siege:auto est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("siege:auto est deja lance")) {
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

function shouldLogAgain(lastLoggedAt, cooldownMs) {
  return Date.now() - lastLoggedAt >= cooldownMs;
}

function getX(entity) {
  return Number(entity?.x ?? entity?.coord_x ?? entity?.positionX ?? 0);
}

function getY(entity) {
  return Number(entity?.y ?? entity?.coord_y ?? entity?.positionY ?? 0);
}

function getCellKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function printStatus(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(getX(left) - getX(right)), Math.abs(getY(left) - getY(right)));
}

function isAdjacent(left, right) {
  return chebyshevDistance(left, right) === 1;
}

function normalizeShipName(value) {
  return normalizeText(String(value));
}

function findShipByName(ships, name) {
  const normalized = normalizeShipName(name);
  return ships.find((ship) => normalizeShipName(ship.nom) === normalized) ?? null;
}

function buildCellLookup(cells) {
  const lookup = new Map();

  for (const cell of cells) {
    lookup.set(getCellKey(cell.coord_x, cell.coord_y), cell);
  }

  return lookup;
}

function buildLocalRange(ship, radius = 8) {
  return {
    xMin: Math.max(0, getX(ship) - radius),
    xMax: Math.min(MAP_SIZE - 1, getX(ship) + radius),
    yMin: Math.max(0, getY(ship) - radius),
    yMax: Math.min(MAP_SIZE - 1, getY(ship) + radius)
  };
}

async function getVisibleCellsForShips(ships, radius = 8) {
  const byCoord = new Map();
  const queryRadius = Math.min(radius, 6);

  for (const ship of ships) {
    // The live API starts dropping planet payloads on wider map windows.
    // Keep target discovery on smaller, reliable scans around each ship.
    const range = buildLocalRange(ship, queryRadius);
    const cells = await getMap(range.xMin, range.xMax, range.yMin, range.yMax);

    for (const cell of cells) {
      byCoord.set(getCellKey(cell.coord_x, cell.coord_y), cell);
    }
  }

  return [...byCoord.values()];
}

function mergeCellLookups(...lookups) {
  const merged = new Map();

  for (const lookup of lookups) {
    if (!lookup) {
      continue;
    }

    for (const [key, value] of lookup.entries()) {
      merged.set(key, value);
    }
  }

  return merged;
}

async function getLocalCellLookup(points, padding = 1) {
  const xs = points.map((point) => getX(point));
  const ys = points.map((point) => getY(point));
  const xMin = Math.max(0, Math.min(...xs) - padding);
  const xMax = Math.min(MAP_SIZE - 1, Math.max(...xs) + padding);
  const yMin = Math.max(0, Math.min(...ys) - padding);
  const yMax = Math.min(MAP_SIZE - 1, Math.max(...ys) + padding);
  const cells = await getMap(xMin, xMax, yMin, yMax);
  return buildCellLookup(cells);
}

function buildExplorationWaypoints(step = 6) {
  const waypoints = [];

  for (let x = 0; x < MAP_SIZE; x += step) {
    for (let y = 0; y < MAP_SIZE; y += step) {
      waypoints.push({ x, y });
    }
  }

  waypoints.push({ x: MAP_SIZE - 1, y: MAP_SIZE - 1 });
  return waypoints;
}

function isWaypointCovered(waypoint, ships, radius) {
  return ships.some((ship) => chebyshevDistance(ship, waypoint) <= radius);
}

function chooseExplorationWaypoint(ship, allAttackShips, radius, usedWaypointKeys) {
  const waypoints = buildExplorationWaypoints(6).filter((waypoint) => {
    const key = getCellKey(waypoint.x, waypoint.y);

    if (usedWaypointKeys.has(key)) {
      return false;
    }

    return !isWaypointCovered(waypoint, allAttackShips, radius);
  });

  if (waypoints.length === 0) {
    return null;
  }

  waypoints.sort((left, right) => chebyshevDistance(ship, left) - chebyshevDistance(ship, right));
  return waypoints[0];
}

function sameCoord(left, right) {
  return getX(left) === getX(right) && getY(left) === getY(right);
}

function chooseExplorationMove(ship, waypoint, occupiedCells, cellLookup, previousPosition = null) {
  const candidates = buildAdjacentCells(ship).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, cellLookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  const currentDistance = chebyshevDistance(ship, waypoint);

  candidates.sort((left, right) => {
    const leftImproves = Number(chebyshevDistance(left, waypoint) < currentDistance);
    const rightImproves = Number(chebyshevDistance(right, waypoint) < currentDistance);

    if (leftImproves !== rightImproves) {
      return rightImproves - leftImproves;
    }

    const leftBacktrack = Number(previousPosition && sameCoord(left, previousPosition));
    const rightBacktrack = Number(previousPosition && sameCoord(right, previousPosition));

    if (leftBacktrack !== rightBacktrack) {
      return leftBacktrack - rightBacktrack;
    }

    const leftDistance = chebyshevDistance(left, waypoint);
    const rightDistance = chebyshevDistance(right, waypoint);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return left.x - right.x || left.y - right.y;
  });

  return candidates[0];
}

function cleanupExplorationState(attackShips, explorationTargets, previousPositions) {
  const activeIds = new Set(attackShips.map((ship) => ship.id));

  for (const shipId of [...explorationTargets.keys()]) {
    if (!activeIds.has(shipId)) {
      explorationTargets.delete(shipId);
    }
  }

  for (const shipId of [...previousPositions.keys()]) {
    if (!activeIds.has(shipId)) {
      previousPositions.delete(shipId);
    }
  }
}

function getAssignedWaypointKeys(explorationTargets) {
  return new Set(
    [...explorationTargets.values()]
      .filter(Boolean)
      .map((waypoint) => getCellKey(waypoint.x, waypoint.y))
  );
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

function isOccupiedCell(x, y, occupiedCells) {
  return occupiedCells.has(getCellKey(x, y));
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

function isPassableCoord(x, y, lookup) {
  const cell = lookup.get(getCellKey(x, y));
  return cell ? isPassableCell(cell) : false;
}

function buildAdjacentCells(target) {
  const cells = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const x = getX(target) + dx;
      const y = getY(target) + dy;

      if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) {
        continue;
      }

      cells.push({ x, y });
    }
  }

  return cells;
}

function nextStepToward(ship, target) {
  return {
    x: getX(ship) + Math.sign(getX(target) - getX(ship)),
    y: getY(ship) + Math.sign(getY(target) - getY(ship))
  };
}

function pickStagingCell(ship, target, occupiedCells, lookup) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, lookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftScore = chebyshevDistance(ship, left);
    const rightScore = chebyshevDistance(ship, right);
    return leftScore - rightScore;
  });

  return candidates[0];
}

function chooseNextStep(ship, target, occupiedCells, lookup) {
  const preferred = nextStepToward(ship, target);

  if (
    preferred.x >= 0 &&
    preferred.x < MAP_SIZE &&
    preferred.y >= 0 &&
    preferred.y < MAP_SIZE &&
    !isOccupiedCell(preferred.x, preferred.y, occupiedCells) &&
    isPassableCoord(preferred.x, preferred.y, lookup)
  ) {
    return preferred;
  }

  const alternatives = buildAdjacentCells(ship).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, lookup)
  );

  if (alternatives.length === 0) {
    return null;
  }

  alternatives.sort((left, right) => {
    const leftScore = chebyshevDistance(left, target);
    const rightScore = chebyshevDistance(right, target);
    return leftScore - rightScore;
  });

  return alternatives[0];
}

function parseAvailabilityDate(value) {
  const source = value?.message ?? String(value ?? "");
  const match = source.match(/(\d{2}):(\d{2}):(\d{2})/);

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

function getRetryDelay(error, intervalMs) {
  const availabilityDate = parseAvailabilityDate(error);

  if (availabilityDate) {
    return Math.max(availabilityDate.getTime() - Date.now() + 1000, 1000);
  }

  if (error?.status === 423) {
    return Math.max(intervalMs, 5000);
  }

  if (error?.status === 502 || String(error?.message ?? "").includes("fetch failed")) {
    return Math.max(intervalMs, 10000);
  }

  return intervalMs;
}

function isOccupiedTargetError(error) {
  return String(error?.message ?? "").includes("Case cible déjà occupée");
}

function isNeutralConquerError(error) {
  const message = String(error?.message ?? "");
  return (
    error?.status === 500 &&
    message.includes("getProprietaire()") &&
    message.includes("is null")
  );
}

function isCapitalPlanetError(error) {
  const message = String(error?.message ?? "");
  return error?.status === 400 && message.includes("La planete a une capitale");
}

function isRecoverableError(error) {
  if (!error) {
    return false;
  }

  if (error.status === 401) {
    return false;
  }

  if ([400, 403, 423, 502].includes(error.status)) {
    return true;
  }

  const message = String(error.message ?? "");

  return (
    message.includes("fetch failed") ||
    message.includes("prochaine disponibilite") ||
    message.includes("Case cible") ||
    message.includes("points de vies")
  );
}

function targetOwnedByTeam(team, cell) {
  if (!cell?.planete) {
    return false;
  }

  return (team.planetes || []).some(
    (planet) => getX(planet) === cell.coord_x && getY(planet) === cell.coord_y
  );
}

function hasMeaningfulOwner(cell) {
  return Boolean(cell?.proprietaire?.identifiant || cell?.proprietaire?.nom);
}

function isCombatShip(ship) {
  const shipClass = String(ship?.classe ?? ship?.classeVaisseau ?? "");
  return ["CHASSEUR", "CROISEUR", "AMIRAL"].some((prefix) => shipClass.includes(prefix));
}

function isNonOwnedPlanet(team, cell) {
  if (!cell?.planete || cell.planete.estVide) {
    return false;
  }

  if (targetOwnedByTeam(team, cell)) {
    return false;
  }

  if (team.identifiant && cell.proprietaire?.identifiant === team.identifiant) {
    return false;
  }

  return true;
}

function isEnemyOwnedTarget(team, cell) {
  return isNonOwnedPlanet(team, cell) && hasMeaningfulOwner(cell);
}

function isSiegeableTarget(team, cell, options = {}) {
  const includeNeutral = options.includeNeutral === true;

  if (!isNonOwnedPlanet(team, cell)) {
    return false;
  }

  if (!includeNeutral && !isEnemyOwnedTarget(team, cell)) {
    return false;
  }

  return true;
}

function getClosestShipDistance(ships, cell) {
  return ships.reduce((best, ship) => {
    const distance = chebyshevDistance(ship, cell);
    return Math.min(best, distance);
  }, Number.POSITIVE_INFINITY);
}

function chooseNearestTarget(cells, attackShips, team, options = {}) {
  const targets = cells.filter((cell) => isSiegeableTarget(team, cell, options));

  if (targets.length === 0) {
    return null;
  }

  targets.sort((left, right) => {
    const distanceGap =
      getClosestShipDistance(attackShips, left) - getClosestShipDistance(attackShips, right);

    if (distanceGap !== 0) {
      return distanceGap;
    }

    const rightEnemy = Number(hasMeaningfulOwner(right));
    const leftEnemy = Number(hasMeaningfulOwner(left));

    if (rightEnemy !== leftEnemy) {
      return rightEnemy - leftEnemy;
    }

    const hitPointsGap =
      Number(left.planete?.pointDeVie ?? 0) - Number(right.planete?.pointDeVie ?? 0);

    if (hitPointsGap !== 0) {
      return hitPointsGap;
    }

    return (
      Number(right.planete?.slotsConstruction ?? 0) -
      Number(left.planete?.slotsConstruction ?? 0)
    );
  });

  return targets[0];
}

function pickClaimShip(attackShips, target) {
  return [...attackShips]
    .sort((left, right) => {
      const leftAdjacent = Number(isAdjacent(left, target));
      const rightAdjacent = Number(isAdjacent(right, target));

      if (rightAdjacent !== leftAdjacent) {
        return rightAdjacent - leftAdjacent;
      }

      const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

      if (readyGap !== 0) {
        return readyGap;
      }

      return chebyshevDistance(left, target) - chebyshevDistance(right, target);
    })[0] ?? null;
}

function getTargetLabel(cell) {
  if (!cell?.planete) {
    return "cible inconnue";
  }

  return `${cell.planete.nom} (${cell.coord_x}, ${cell.coord_y})`;
}

function printUsage() {
  console.log("Usage:");
  console.log("npm.cmd run siege:auto");
  console.log('npm.cmd run siege:auto -- "Chasseur 3" "Chasseur M 1"');
  console.log("Optionnel:");
  console.log("  SIEGE_INTERVAL_MS=5000");
  console.log("  SIEGE_TARGET_HP=0");
}

async function main() {
  requireConfig();
  acquireLock();

  const shipNames = process.argv.slice(2);
  const intervalMs = parseNumber(process.env.SIEGE_INTERVAL_MS, 5000);
  const targetHp = parseNumber(process.env.SIEGE_TARGET_HP, 0);
  const scanRadius = Math.max(4, Math.min(parseNumber(process.env.SIEGE_SCAN_RADIUS, 8), 12));
  const includeNeutralTargets = process.env.SIEGE_INCLUDE_NEUTRAL === "1";

  let currentTargetKey = null;
  let lastTargetLogKey = null;
  const explorationTargets = new Map();
  const previousPositions = new Map();
  const temporaryBlockedCells = new Map();
  const blockedTargets = new Map();
  let lastNoTargetLogAt = 0;
  let lastAllWaitingLogAt = 0;

  printStatus(
    `Siege++ lance | cible auto la plus proche visible | seuil conquete ${targetHp} PV`
  );
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    try {
      const [allShips, team] = await Promise.all([getShips(), getTeamState()]);
      const attackShips =
        shipNames.length > 0
          ? shipNames
              .map((name) => findShipByName(allShips, name))
              .filter(Boolean)
          : allShips.filter(isCombatShip);

      if (attackShips.length === 0) {
        printStatus("Aucun vaisseau de combat actif. Nouvelle tentative plus tard.");
        await sleep(intervalMs);
        continue;
      }

      cleanupExplorationState(attackShips, explorationTargets, previousPositions);

      for (const [key, blockedUntil] of blockedTargets.entries()) {
        if (blockedUntil <= Date.now()) {
          blockedTargets.delete(key);
        }
      }

      const cells = await getVisibleCellsForShips(attackShips, scanRadius);
      const cellLookup = buildCellLookup(cells);
      let targetCell = currentTargetKey ? cellLookup.get(currentTargetKey) ?? null : null;
      const targetOptions = { includeNeutral: includeNeutralTargets };

      if (targetCell && blockedTargets.has(getCellKey(targetCell.coord_x, targetCell.coord_y))) {
        targetCell = null;
      }

      if (!targetCell || !isSiegeableTarget(team, targetCell, targetOptions)) {
        targetCell = chooseNearestTarget(
          cells.filter((cell) => !blockedTargets.has(getCellKey(cell.coord_x, cell.coord_y))),
          attackShips,
          team,
          targetOptions
        );
        currentTargetKey = targetCell ? getCellKey(targetCell.coord_x, targetCell.coord_y) : null;
      }

      if (!targetCell) {
        const occupiedCells = new Set(
          allShips.map((ship) => getCellKey(getX(ship), getY(ship)))
        );
        reserveTemporarilyBlockedCells(occupiedCells, temporaryBlockedCells);
        const usedWaypointKeys = getAssignedWaypointKeys(explorationTargets);
        let explorationActions = 0;

        for (const ship of [...attackShips].sort((left, right) => {
          const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

          if (readyGap !== 0) {
            return readyGap;
          }

          return left.nom.localeCompare(right.nom);
        })) {
          const readyDelay = getShipReadyDelay(ship);

          if (readyDelay > 0) {
            printStatus(`${ship.nom} attend encore ${Math.ceil(readyDelay / 1000)}s`);
            continue;
          }

          occupiedCells.delete(getCellKey(getX(ship), getY(ship)));
          let waypoint = explorationTargets.get(ship.id) ?? null;

          if (waypoint && chebyshevDistance(ship, waypoint) <= scanRadius) {
            explorationTargets.delete(ship.id);
            usedWaypointKeys.delete(getCellKey(waypoint.x, waypoint.y));
            waypoint = null;
          }

          if (!waypoint) {
            waypoint = chooseExplorationWaypoint(
              ship,
              attackShips,
              scanRadius,
              usedWaypointKeys
            );
          }

          if (!waypoint) {
            continue;
          }

          explorationTargets.set(ship.id, waypoint);
          usedWaypointKeys.add(getCellKey(waypoint.x, waypoint.y));
          const shipLocalLookup = await getLocalCellLookup([ship], 1);
          const moveTarget = chooseExplorationMove(
            ship,
            waypoint,
            occupiedCells,
            shipLocalLookup,
            previousPositions.get(ship.id) ?? null
          );

          if (!moveTarget) {
            explorationTargets.delete(ship.id);
            continue;
          }

          if (chebyshevDistance(moveTarget, waypoint) >= chebyshevDistance(ship, waypoint)) {
            explorationTargets.delete(ship.id);
            continue;
          }

          reserveCell(occupiedCells, moveTarget);
          previousPositions.set(ship.id, { x: getX(ship), y: getY(ship) });
          printStatus(
            `${ship.nom} explore vers (${waypoint.x}, ${waypoint.y}) via move (${moveTarget.x}, ${moveTarget.y})`
          );
          try {
            await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
          } catch (error) {
            if (!isOccupiedTargetError(error)) {
              throw error;
            }

            explorationTargets.delete(ship.id);
            markCellTemporarilyBlocked(temporaryBlockedCells, moveTarget);
            printStatus(
              `${ship.nom} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`
            );
            continue;
          }
          explorationActions += 1;
        }

        if (explorationActions === 0) {
          if (shouldLogAgain(lastNoTargetLogAt, 15000)) {
            printStatus(
              "Aucune planete ennemie ou conquerable visible pour le moment. Nouvelle tentative plus tard."
            );
            lastNoTargetLogAt = Date.now();
          }
          await sleep(intervalMs);
          continue;
        }

        await sleep(intervalMs);
        continue;
      }

      const target = { x: targetCell.coord_x, y: targetCell.coord_y };
      const targetKey = getCellKey(targetCell.coord_x, targetCell.coord_y);
      explorationTargets.clear();

      if (lastTargetLogKey !== targetKey) {
        printStatus(`Nouvelle cible: ${getTargetLabel(targetCell)}`);
        lastTargetLogKey = targetKey;
      }

      if (targetOwnedByTeam(team, targetCell)) {
        printStatus(`${getTargetLabel(targetCell)} est deja a vous. Recherche d'une autre cible.`);
        currentTargetKey = null;
        lastTargetLogKey = null;
        await sleep(intervalMs);
        continue;
      }

      printStatus(
        `Cible ${targetCell.planete.nom} | proprio ${targetCell.proprietaire?.nom ?? "aucun"} | PV ${targetCell.planete.pointDeVie}`
      );

      const hitPoints = Number(targetCell.planete.pointDeVie ?? 0);
      const occupiedCells = buildOccupiedCells(allShips);
      reserveTemporarilyBlockedCells(occupiedCells, temporaryBlockedCells);
      let actionsDone = 0;
      let retargetRequested = false;

      if (hitPoints <= targetHp) {
        const claimShip = pickClaimShip(attackShips, target);

        if (!claimShip) {
          printStatus("Aucun vaisseau disponible pour la conquete. Nouvelle tentative plus tard.");
          await sleep(intervalMs);
          continue;
        }

        const readyDelay = getShipReadyDelay(claimShip);

        if (readyDelay > 0) {
          printStatus(
            `${claimShip.nom} attend encore ${Math.ceil(readyDelay / 1000)}s avant la conquete`
          );
          await sleep(Math.max(readyDelay + 250, intervalMs));
          continue;
        }

        occupiedCells.delete(getCellKey(getX(claimShip), getY(claimShip)));

        if (isAdjacent(claimShip, target)) {
          printStatus(`${claimShip.nom} tente CONQUERIR sur (${target.x}, ${target.y})`);
          try {
            await sendShipAction(claimShip.id, "CONQUERIR", target.x, target.y);
          } catch (error) {
            if (!isNeutralConquerError(error)) {
              throw error;
            }

            blockedTargets.set(getCellKey(target.x, target.y), Date.now() + 10 * 60 * 1000);
            printStatus(
              `${getTargetLabel(targetCell)} ignoree temporairement: conquete impossible sur une planete neutre`
            );
            currentTargetKey = null;
            lastTargetLogKey = null;
            await sleep(500);
            continue;
          }
          currentTargetKey = null;
          lastTargetLogKey = null;
          await sleep(intervalMs);
          continue;
        }

        const claimTargetLookup = await getLocalCellLookup([target], 1);
        const claimStage = pickStagingCell(
          claimShip,
          target,
          occupiedCells,
          mergeCellLookups(cellLookup, claimTargetLookup)
        );

        if (!claimStage) {
          throw new Error("Aucune case libre pour approcher la conquete.");
        }

        const claimShipLookup = await getLocalCellLookup([claimShip], 1);
        const moveTarget = chooseNextStep(
          claimShip,
          claimStage,
          occupiedCells,
          mergeCellLookups(cellLookup, claimShipLookup)
        );

        if (!moveTarget) {
          throw new Error("Aucun chemin libre pour le vaisseau de conquete.");
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(
          `${claimShip.nom} se positionne pour conquerir: move (${moveTarget.x}, ${moveTarget.y})`
        );
        try {
          await sendShipAction(claimShip.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        } catch (error) {
          if (!isOccupiedTargetError(error)) {
            throw error;
          }

          markCellTemporarilyBlocked(temporaryBlockedCells, moveTarget);
          printStatus(
            `${claimShip.nom} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`
          );
          await sleep(500);
          continue;
        }
        await sleep(intervalMs);
        continue;
      }

      const attackOrder = [...attackShips].sort((left, right) => {
        const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

        if (readyGap !== 0) {
          return readyGap;
        }

        return chebyshevDistance(left, target) - chebyshevDistance(right, target);
      });

      for (const ship of attackOrder) {
        const readyDelay = getShipReadyDelay(ship);

        if (readyDelay > 0) {
          printStatus(`${ship.nom} attend encore ${Math.ceil(readyDelay / 1000)}s`);
          continue;
        }

        occupiedCells.delete(getCellKey(getX(ship), getY(ship)));

        if (isAdjacent(ship, target)) {
          printStatus(`${ship.nom} attaque (${target.x}, ${target.y})`);
          try {
            await sendShipAction(ship.id, "ATTAQUER", target.x, target.y);
          } catch (error) {
            if (!isCapitalPlanetError(error)) {
              throw error;
            }

            blockedTargets.set(targetKey, Date.now() + 30 * 60 * 1000);
            currentTargetKey = null;
            lastTargetLogKey = null;
            printStatus(
              `${getTargetLabel(targetCell)} ignoree temporairement: capitale impossible a attaquer`
            );
            retargetRequested = true;
            break;
          }
          actionsDone += 1;
          continue;
        }

        const targetLocalLookup = await getLocalCellLookup([target], 1);
        const stage = pickStagingCell(
          ship,
          target,
          occupiedCells,
          mergeCellLookups(cellLookup, targetLocalLookup)
        );

        if (!stage) {
          continue;
        }

        const shipLocalLookup = await getLocalCellLookup([ship], 1);
        const moveTarget = chooseNextStep(
          ship,
          stage,
          occupiedCells,
          mergeCellLookups(cellLookup, shipLocalLookup)
        );

        if (!moveTarget) {
          continue;
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(`${ship.nom} approche la cible: move (${moveTarget.x}, ${moveTarget.y})`);
        try {
          await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        } catch (error) {
          if (!isOccupiedTargetError(error)) {
            throw error;
          }

          markCellTemporarilyBlocked(temporaryBlockedCells, moveTarget);
          printStatus(
            `${ship.nom} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`
          );
          continue;
        }
        actionsDone += 1;
      }

      if (retargetRequested) {
        await sleep(500);
        continue;
      }

      if (actionsDone === 0) {
        if (shouldLogAgain(lastAllWaitingLogAt, 15000)) {
          printStatus("Tous les vaisseaux de combat attendent ou sont bloques. Nouvelle tentative.");
          lastAllWaitingLogAt = Date.now();
        }
      }

      await sleep(actionsDone > 0 ? intervalMs : Math.max(intervalMs, 3000));
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
