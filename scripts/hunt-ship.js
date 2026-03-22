const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const {
  getMap,
  getShips,
  getTeamState,
  normalizeText,
  requireConfig,
  sendShipAction
} = require("./game");

const MAP_SIZE = 58;
const LOCK_FILE = path.join(__dirname, ".hunt-ship.lock");
const GET_ALL_SHIPS_MODULE_URL = pathToFileURL(
  path.join(__dirname, "..", "Backend", "getAllVaisseaux.js")
).href;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCycleSleepDelay(cycleStartedAt, minDelayMs) {
  return Math.max(cycleStartedAt + minDelayMs - Date.now(), 0);
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
          `hunt est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("hunt est deja lance")) {
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

function getShipLabel(ship) {
  const rawId = String(ship?.id ?? ship?.idVaisseau ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6);

  return rawId ? `${ship.nom} [${rawId}]` : ship.nom;
}

function normalizeShipName(value) {
  return normalizeText(String(value));
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(getX(left) - getX(right)), Math.abs(getY(left) - getY(right)));
}

function isAdjacent(left, right) {
  return chebyshevDistance(left, right) === 1;
}

function isCombatShip(ship) {
  const shipClass = String(ship?.classe ?? ship?.classeVaisseau ?? "");
  return ["CHASSEUR", "CROISEUR", "AMIRAL"].some((prefix) => shipClass.includes(prefix));
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

function buildSearchNeighbors(origin, destination) {
  return buildAdjacentCells(origin).sort((left, right) => {
    const leftScore = chebyshevDistance(left, destination);
    const rightScore = chebyshevDistance(right, destination);

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.x - right.x || left.y - right.y;
  });
}

function buildCellLookup(cells) {
  const lookup = new Map();

  for (const cell of cells) {
    lookup.set(getCellKey(cell.coord_x, cell.coord_y), cell);
  }

  return lookup;
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

function isOccupiedCell(x, y, occupiedCells) {
  return occupiedCells.has(getCellKey(x, y));
}

function buildOccupiedCells(alliedShips, enemyShips, ignoredShipId, ignoredTargetCell = null) {
  const occupied = new Set();
  const ignoredTargetKey = ignoredTargetCell
    ? getCellKey(getX(ignoredTargetCell), getY(ignoredTargetCell))
    : null;

  for (const ship of alliedShips) {
    if (ship.id === ignoredShipId) {
      continue;
    }

    occupied.add(getCellKey(getX(ship), getY(ship)));
  }

  for (const ship of enemyShips) {
    const shipKey = getCellKey(getX(ship), getY(ship));

    if (shipKey === ignoredTargetKey) {
      continue;
    }

    occupied.add(shipKey);
  }

  return occupied;
}

function reserveCell(occupiedCells, cell) {
  occupiedCells.add(getCellKey(cell.x, cell.y));
}

function nextStepToward(ship, target) {
  return {
    x: getX(ship) + Math.sign(getX(target) - getX(ship)),
    y: getY(ship) + Math.sign(getY(target) - getY(ship))
  };
}

function findPathStep(ship, target, occupiedCells, lookup) {
  const startKey = getCellKey(getX(ship), getY(ship));
  const targetKey = getCellKey(target.x, target.y);

  if (startKey === targetKey) {
    return null;
  }

  const queue = [{ x: getX(ship), y: getY(ship) }];
  const visited = new Set([startKey]);
  const firstStepByKey = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = getCellKey(current.x, current.y);

    for (const neighbor of buildSearchNeighbors(current, target)) {
      const neighborKey = getCellKey(neighbor.x, neighbor.y);

      if (visited.has(neighborKey)) {
        continue;
      }

      if (isOccupiedCell(neighbor.x, neighbor.y, occupiedCells)) {
        continue;
      }

      if (!isPassableCoord(neighbor.x, neighbor.y, lookup)) {
        continue;
      }

      visited.add(neighborKey);
      firstStepByKey.set(
        neighborKey,
        currentKey === startKey ? neighbor : firstStepByKey.get(currentKey)
      );

      if (neighborKey === targetKey) {
        return firstStepByKey.get(neighborKey) ?? null;
      }

      queue.push(neighbor);
    }
  }

  return null;
}

function getPathDistance(ship, target, occupiedCells, lookup) {
  const startKey = getCellKey(getX(ship), getY(ship));
  const targetKey = getCellKey(target.x, target.y);

  if (startKey === targetKey) {
    return 0;
  }

  const queue = [{ x: getX(ship), y: getY(ship), distance: 0 }];
  const visited = new Set([startKey]);

  while (queue.length > 0) {
    const current = queue.shift();

    for (const neighbor of buildSearchNeighbors(current, target)) {
      const neighborKey = getCellKey(neighbor.x, neighbor.y);

      if (visited.has(neighborKey)) {
        continue;
      }

      if (isOccupiedCell(neighbor.x, neighbor.y, occupiedCells)) {
        continue;
      }

      if (!isPassableCoord(neighbor.x, neighbor.y, lookup)) {
        continue;
      }

      if (neighborKey === targetKey) {
        return current.distance + 1;
      }

      visited.add(neighborKey);
      queue.push({ ...neighbor, distance: current.distance + 1 });
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getSlotBlockingScore(slot, ships, target, ignoredShipId = null) {
  if (!Array.isArray(ships) || ships.length === 0) {
    return 0;
  }

  let directPressure = 0;
  let nearbyPressure = 0;

  for (const otherShip of ships) {
    if (!otherShip || otherShip.id === ignoredShipId || isAdjacent(otherShip, target)) {
      continue;
    }

    const preferredStep = nextStepToward(otherShip, target);

    if (getCellKey(preferredStep.x, preferredStep.y) === getCellKey(slot.x, slot.y)) {
      directPressure += 1;
    }

    const distance = chebyshevDistance(otherShip, slot);

    if (distance <= 2) {
      nearbyPressure += 3 - distance;
    }
  }

  return directPressure * 100 + nearbyPressure;
}

function chooseRangeAdjustmentCell(ship, target, ships, occupiedCells, lookup) {
  if (!isAdjacent(ship, target)) {
    return null;
  }

  const currentScore = getSlotBlockingScore(ship, ships, target, ship.id);

  if (currentScore <= 0) {
    return null;
  }

  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      chebyshevDistance(ship, cell) === 1 &&
      getCellKey(cell.x, cell.y) !== getCellKey(getX(ship), getY(ship)) &&
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, lookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftScore = getSlotBlockingScore(left, ships, target, ship.id);
    const rightScore = getSlotBlockingScore(right, ships, target, ship.id);

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.x - right.x || left.y - right.y;
  });

  const bestCandidate = candidates[0];
  return getSlotBlockingScore(bestCandidate, ships, target, ship.id) < currentScore
    ? bestCandidate
    : null;
}

function pickStagingCell(attacker, target, occupiedCells, lookup, attackers = []) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, lookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftBlockingScore = getSlotBlockingScore(left, attackers, target, attacker.id);
    const rightBlockingScore = getSlotBlockingScore(right, attackers, target, attacker.id);

    if (leftBlockingScore !== rightBlockingScore) {
      return leftBlockingScore - rightBlockingScore;
    }

    const leftPathDistance = getPathDistance(attacker, left, occupiedCells, lookup);
    const rightPathDistance = getPathDistance(attacker, right, occupiedCells, lookup);

    if (leftPathDistance !== rightPathDistance) {
      return leftPathDistance - rightPathDistance;
    }

    return chebyshevDistance(attacker, left) - chebyshevDistance(attacker, right);
  });

  return candidates[0];
}

function chooseNextStep(ship, target, occupiedCells, lookup) {
  const pathStep = findPathStep(ship, target, occupiedCells, lookup);

  if (pathStep) {
    return pathStep;
  }

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

  return String(error.message ?? "").includes("fetch failed");
}

function isOccupiedTargetError(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes("Case cible dÃ©jÃ  occupÃ©e") ||
    message.includes("Case cible deja occupee") ||
    message.includes("Case cible dÃƒÂ©jÃƒÂ  occupÃƒÂ©e")
  );
}

function buildAttackers(ships, attackerNames) {
  if (attackerNames.length > 0) {
    const normalized = attackerNames.map((name) => normalizeShipName(name));
    return ships.filter((ship) => normalized.includes(normalizeShipName(ship.nom)));
  }

  return ships.filter(isCombatShip);
}

function parseFocusArgs(args) {
  if (args.length >= 2) {
    const x = Number(args[0]);
    const y = Number(args[1]);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      return {
        focusPoint: { x, y },
        attackerNames: args.slice(2)
      };
    }
  }

  return {
    focusPoint: null,
    attackerNames: args
  };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f-]{4,}$/i.test(String(value));
}

function matchesTargetShip(ship, targetQuery) {
  const rawId = String(ship?.idVaisseau ?? ship?.id ?? "");
  const query = String(targetQuery ?? "").trim();
  const normalizedQuery = normalizeShipName(query);

  if (rawId && rawId === query) {
    return 0;
  }

  if (rawId && query.length >= 6 && rawId.startsWith(query)) {
    return 1;
  }

  const normalizedName = normalizeShipName(ship?.nom ?? "");

  if (normalizedName === normalizedQuery) {
    return 2;
  }

  if (!isUuidLike(query) && normalizedName.includes(normalizedQuery)) {
    return 3;
  }

  return Number.POSITIVE_INFINITY;
}

function findTargetShip(enemyShips, targetQuery, attackers, focusPoint = null) {
  const matches = enemyShips
    .map((ship) => ({
      ship,
      rank: matchesTargetShip(ship, targetQuery)
    }))
    .filter((entry) => Number.isFinite(entry.rank));

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }

    if (focusPoint) {
      const leftFocusDistance = chebyshevDistance(left.ship, focusPoint);
      const rightFocusDistance = chebyshevDistance(right.ship, focusPoint);

      if (leftFocusDistance !== rightFocusDistance) {
        return leftFocusDistance - rightFocusDistance;
      }
    }

    const leftDistance = attackers.reduce(
      (best, attacker) => Math.min(best, chebyshevDistance(attacker, left.ship)),
      Number.POSITIVE_INFINITY
    );
    const rightDistance = attackers.reduce(
      (best, attacker) => Math.min(best, chebyshevDistance(attacker, right.ship)),
      Number.POSITIVE_INFINITY
    );

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return String(left.ship.nom).localeCompare(String(right.ship.nom));
  });

  return matches[0].ship;
}

async function getAllVaisseaux() {
  const { getAllVaisseaux: loadAllShips } = await import(GET_ALL_SHIPS_MODULE_URL);
  return loadAllShips();
}

function printUsage() {
  console.log("Usage:");
  console.log('npm.cmd run hunt -- "Nom Ennemi"');
  console.log('npm.cmd run hunt -- "Nom Ennemi" 33 52');
  console.log('npm.cmd run hunt -- "Nom Ennemi" "Chasseur M 1" "Chasseur M 2"');
  console.log('npm.cmd run hunt -- "Nom Ennemi" 33 52 "Chasseur M 1" "Chasseur M 2"');
  console.log('npm.cmd run hunt -- "29be59a1-c938-4d8f-8b25-2132e2281cd8" "Amiral 1"');
  console.log("Optionnel:");
  console.log("  HUNT_INTERVAL_MS=3000");
}

async function main() {
  requireConfig();
  acquireLock();

  const [targetQuery, ...rawArgs] = process.argv.slice(2);
  const { focusPoint, attackerNames } = parseFocusArgs(rawArgs);
  const intervalMs = parseNumber(process.env.HUNT_INTERVAL_MS, 3000);
  let lastKnownTarget = null;
  let missedTargetCount = 0;

  if (!targetQuery) {
    printUsage();
    throw new Error("Il faut fournir un vaisseau ennemi cible.");
  }

  printStatus(`Hunt lance sur la cible: ${targetQuery}`);
  if (focusPoint) {
    printStatus(`Point de focus: (${focusPoint.x}, ${focusPoint.y})`);
  }
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    const cycleStartedAt = Date.now();

    try {
      const [alliedShips, team, allShipsOnMap] = await Promise.all([
        getShips(),
        getTeamState(),
        getAllVaisseaux()
      ]);

      const attackers = buildAttackers(alliedShips, attackerNames);

      if (attackers.length === 0) {
        throw new Error("Aucun vaisseau d'assaut disponible.");
      }

      const teamName = normalizeShipName(team?.nom ?? "");
      const enemyShips = allShipsOnMap.filter(
        (ship) => normalizeShipName(ship?.equipe ?? "") !== teamName
      );

      const targetShip = findTargetShip(enemyShips, targetQuery, attackers, focusPoint);

      if (!targetShip) {
        missedTargetCount += 1;

        if (lastKnownTarget && missedTargetCount >= 2) {
          printStatus(
            `Cible ${getShipLabel(lastKnownTarget)} introuvable sur la map globale. Probablement detruite ou hors jeu.`
          );
          return;
        }

        if (!focusPoint) {
          printStatus(`Cible ${targetQuery} introuvable pour le moment. Nouvelle tentative.`);
          await sleep(getCycleSleepDelay(cycleStartedAt, intervalMs));
          continue;
        }

        printStatus(
          `Cible ${targetQuery} introuvable pour le moment. Approche de la zone (${focusPoint.x}, ${focusPoint.y}).`
        );

        const occupiedCells = buildOccupiedCells(alliedShips, enemyShips, null, null);
        let actionsDone = 0;

        for (const attacker of [...attackers].sort((left, right) => {
          const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

          if (readyGap !== 0) {
            return readyGap;
          }

          return chebyshevDistance(left, focusPoint) - chebyshevDistance(right, focusPoint);
        })) {
          const readyDelay = getShipReadyDelay(attacker);

          if (readyDelay > 0) {
            printStatus(`${getShipLabel(attacker)} attend encore ${Math.ceil(readyDelay / 1000)}s`);
            continue;
          }

          occupiedCells.delete(getCellKey(getX(attacker), getY(attacker)));
          const localLookup = await getLocalCellLookup([attacker], 2);
          const moveTarget = chooseNextStep(attacker, focusPoint, occupiedCells, localLookup);

          if (!moveTarget) {
            continue;
          }

          reserveCell(occupiedCells, moveTarget);
          printStatus(
            `${getShipLabel(attacker)} avance vers la zone: move (${moveTarget.x}, ${moveTarget.y})`
          );

          try {
            await sendShipAction(attacker.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
          } catch (error) {
            if (!isRecoverableError(error)) {
              throw error;
            }

            if (isOccupiedTargetError(error)) {
              printStatus(
                `${getShipLabel(attacker)} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`
              );
              continue;
            }

            printStatus(`${getShipLabel(attacker)} reporte son action: ${error.message}`);
            continue;
          }

          actionsDone += 1;
        }

        if (actionsDone === 0) {
          printStatus("Aucune action utile ce tour. Nouvelle tentative.");
        }

        await sleep(getCycleSleepDelay(cycleStartedAt, intervalMs));
        continue;
      }

      missedTargetCount = 0;
      lastKnownTarget = targetShip;
      const target = { x: getX(targetShip), y: getY(targetShip) };

      printStatus(
        `Cible ${getShipLabel(targetShip)} | equipe ${targetShip.equipe ?? "inconnue"} | PV ${targetShip.pointDeVie ?? "?"} | (${target.x}, ${target.y})`
      );

      const occupiedCells = buildOccupiedCells(alliedShips, enemyShips, null, target);
      let actionsDone = 0;

      const attackOrder = [...attackers].sort((left, right) => {
        const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

        if (readyGap !== 0) {
          return readyGap;
        }

        return chebyshevDistance(left, target) - chebyshevDistance(right, target);
      });

      for (const attacker of attackOrder) {
        const readyDelay = getShipReadyDelay(attacker);

        if (readyDelay > 0) {
          printStatus(`${getShipLabel(attacker)} attend encore ${Math.ceil(readyDelay / 1000)}s`);
          continue;
        }

        occupiedCells.delete(getCellKey(getX(attacker), getY(attacker)));

        const targetLookup = await getLocalCellLookup([attacker, target], 3);

        if (isAdjacent(attacker, target)) {
          const sidestepCell = chooseRangeAdjustmentCell(
            attacker,
            target,
            attackers,
            occupiedCells,
            targetLookup
          );

          if (sidestepCell) {
            reserveCell(occupiedCells, sidestepCell);
            printStatus(
              `${getShipLabel(attacker)} se decale pour liberer l'approche: move (${sidestepCell.x}, ${sidestepCell.y})`
            );
            try {
              await sendShipAction(attacker.id, "DEPLACEMENT", sidestepCell.x, sidestepCell.y);
            } catch (error) {
              if (!isRecoverableError(error)) {
                throw error;
              }

              if (isOccupiedTargetError(error)) {
                printStatus(
                  `${getShipLabel(attacker)} replannifie: la case (${sidestepCell.x}, ${sidestepCell.y}) est deja occupee`
                );
                continue;
              }

              printStatus(`${getShipLabel(attacker)} reporte son action: ${error.message}`);
              continue;
            }
            actionsDone += 1;
            continue;
          }

          printStatus(
            `${getShipLabel(attacker)} attaque ${getShipLabel(targetShip)} sur (${target.x}, ${target.y})`
          );
          await sendShipAction(attacker.id, "ATTAQUER", target.x, target.y);
          actionsDone += 1;
          continue;
        }

        const stage = pickStagingCell(attacker, target, occupiedCells, targetLookup, attackers);

        if (!stage) {
          printStatus(
            `${getShipLabel(attacker)} ne trouve pas de case libre autour de ${getShipLabel(targetShip)}`
          );
          continue;
        }

        const moveTarget = chooseNextStep(attacker, stage, occupiedCells, targetLookup);

        if (!moveTarget) {
          printStatus(
            `${getShipLabel(attacker)} ne trouve pas de pas valide vers ${getShipLabel(targetShip)}`
          );
          continue;
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(
          `${getShipLabel(attacker)} approche ${getShipLabel(targetShip)}: move (${moveTarget.x}, ${moveTarget.y})`
        );

        try {
          await sendShipAction(attacker.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          if (isOccupiedTargetError(error)) {
            printStatus(
              `${getShipLabel(attacker)} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`
            );
            continue;
          }

          printStatus(`${getShipLabel(attacker)} reporte son action: ${error.message}`);
          continue;
        }

        actionsDone += 1;
      }

      if (actionsDone === 0) {
        printStatus("Aucune action utile ce tour. Nouvelle tentative.");
      }

      await sleep(
        getCycleSleepDelay(
          cycleStartedAt,
          actionsDone > 0 ? intervalMs : Math.max(intervalMs, 3000)
        )
      );
    } catch (error) {
      if (!isRecoverableError(error)) {
        throw error;
      }

      const retryDelay = getRetryDelay(error, intervalMs);
      printStatus(
        `Hunt reporte: ${error.message}. Nouvelle tentative dans ${Math.ceil(
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
