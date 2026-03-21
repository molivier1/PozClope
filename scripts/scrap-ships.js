const fs = require("fs");
const path = require("path");

const {
  getMap,
  getShips,
  normalizeText,
  requireConfig,
  sendShipAction
} = require("./game");

const MAP_SIZE = 58;
const LOCK_FILE = path.join(__dirname, ".scrap-ships.lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const shortId = String(ship?.id ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6);

  return shortId ? `${ship.nom} [${shortId}]` : ship.nom;
}

function normalizeShipName(value) {
  return normalizeText(String(value));
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
    // Verrou best-effort.
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));

      if (current?.pid && current.pid !== process.pid && isProcessAlive(current.pid)) {
        throw new Error(
          `scrap est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("scrap est deja lance")) {
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

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(getX(left) - getX(right)), Math.abs(getY(left) - getY(right)));
}

function isAdjacent(left, right) {
  return chebyshevDistance(left, right) === 1;
}

function isCombatShip(ship) {
  const shipClass = String(ship?.classe ?? ship?.classeVaisseau ?? "");
  return (
    shipClass.includes("CHASSEUR") ||
    shipClass.includes("CROISEUR") ||
    shipClass.includes("AMIRAL")
  );
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

function nextStepToward(ship, target) {
  return {
    x: getX(ship) + Math.sign(getX(target) - getX(ship)),
    y: getY(ship) + Math.sign(getY(target) - getY(ship))
  };
}

function chooseNextStep(ship, target, occupiedCells, cellLookup) {
  const preferred = nextStepToward(ship, target);

  if (
    !isOccupiedCell(preferred.x, preferred.y, occupiedCells) &&
    isPassableCoord(preferred.x, preferred.y, cellLookup)
  ) {
    return preferred;
  }

  const alternatives = buildAdjacentCells(ship).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, cellLookup)
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

function pickStagingCell(attacker, target, occupiedCells, cellLookup) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, cellLookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftScore = chebyshevDistance(attacker, left);
    const rightScore = chebyshevDistance(attacker, right);
    return leftScore - rightScore;
  });

  return candidates[0];
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
    String(error.message ?? "").includes("fetch failed")
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

function findShipsByNames(ships, names) {
  const normalizedTargets = names.map((name) => normalizeShipName(name));
  return ships.filter((ship) => normalizedTargets.includes(normalizeShipName(ship.nom)));
}

function buildAttackers(ships, targetNames) {
  const targetSet = new Set(targetNames.map((name) => normalizeShipName(name)));
  const override = (process.env.SCRAP_ATTACKERS || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (override.length > 0) {
    const attackers = findShipsByNames(ships, override).filter((ship) => !targetSet.has(normalizeShipName(ship.nom)));
    return attackers;
  }

  return ships.filter(
    (ship) => isCombatShip(ship) && !targetSet.has(normalizeShipName(ship.nom))
  );
}

function printUsage() {
  console.log("Usage:");
  console.log('npm.cmd run scrap -- "Cargo M 1" "Cargo L 4"');
  console.log("Optionnel:");
  console.log('  $env:SCRAP_ATTACKERS="Chasseur M 1,Chasseur M 3,chasseur 4,Chasseur 5"');
}

async function main() {
  requireConfig();
  acquireLock();

  const targetNames = process.argv.slice(2);
  const intervalMs = parseNumber(process.env.SCRAP_INTERVAL_MS, 5000);

  if (targetNames.length === 0) {
    printUsage();
    throw new Error("Il faut fournir au moins un vaisseau cible.");
  }

  printStatus(`Scrap lance pour: ${targetNames.join(", ")}`);
  printStatus("Arrete d'abord les scripts auto qui pilotent ces vaisseaux.");
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    try {
      const ships = await getShips();
      const targets = findShipsByNames(ships, targetNames);

      if (targets.length === 0) {
        printStatus("Toutes les cibles ont disparu de la flotte active.");
        return;
      }

      const attackers = buildAttackers(ships, targetNames);

      if (attackers.length === 0) {
        throw new Error("Aucun vaisseau de combat disponible pour le scrap.");
      }

      let actionsDone = 0;

      for (const target of [...targets].sort((left, right) => left.nom.localeCompare(right.nom))) {
        const orderedAttackers = [...attackers].sort((left, right) => {
          const readyGap = getShipReadyDelay(left) - getShipReadyDelay(right);

          if (readyGap !== 0) {
            return readyGap;
          }

          return chebyshevDistance(left, target) - chebyshevDistance(right, target);
        });

        const attacker = orderedAttackers[0];

        if (!attacker) {
          continue;
        }

        const attackerLabel = getShipLabel(attacker);
        const targetLabel = getShipLabel(target);
        const readyDelay = getShipReadyDelay(attacker);

        if (readyDelay > 0) {
          printStatus(`${attackerLabel} attend encore ${Math.ceil(readyDelay / 1000)}s`);
          continue;
        }

        const occupiedCells = buildOccupiedCells(ships, attacker.id);

        if (isAdjacent(attacker, target)) {
          printStatus(`${attackerLabel} attaque ${targetLabel} sur (${getX(target)}, ${getY(target)})`);
          await sendShipAction(attacker.id, "ATTAQUER", getX(target), getY(target));
          actionsDone += 1;
          continue;
        }

        const targetLookup = await getLocalCellLookup([target], 1);
        const attackerLookup = await getLocalCellLookup([attacker], 1);
        const localLookup = new Map([...targetLookup, ...attackerLookup]);
        const stage = pickStagingCell(attacker, target, occupiedCells, localLookup);

        if (!stage) {
          printStatus(`${attackerLabel} ne trouve pas de case libre autour de ${targetLabel}`);
          continue;
        }

        const moveTarget = chooseNextStep(attacker, stage, occupiedCells, localLookup);

        if (!moveTarget) {
          printStatus(`${attackerLabel} ne trouve pas de pas valide vers ${targetLabel}`);
          continue;
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(`${attackerLabel} approche ${targetLabel}: move (${moveTarget.x}, ${moveTarget.y})`);

        try {
          await sendShipAction(attacker.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
          actionsDone += 1;
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          if (isOccupiedTargetError(error)) {
            printStatus(`${attackerLabel} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`);
            continue;
          }

          printStatus(`${attackerLabel} reporte son action: ${error.message}`);
        }
      }

      if (actionsDone === 0) {
        printStatus("Aucune action utile ce tour. Nouvelle tentative.");
      }

      await sleep(intervalMs);
    } catch (error) {
      if (!isRecoverableError(error)) {
        throw error;
      }

      const availabilityDate = parseAvailabilityDate(error);
      const retryDelay = availabilityDate
        ? Math.max(availabilityDate.getTime() - Date.now() + 1000, intervalMs)
        : intervalMs;

      printStatus(
        `Scrap reporte: ${error.message}. Nouvelle tentative dans ${Math.ceil(retryDelay / 1000)}s`
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
