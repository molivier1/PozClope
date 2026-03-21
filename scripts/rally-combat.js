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
const LOCK_FILE = path.join(__dirname, ".rally-combat.lock");

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
          `rally est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("rally est deja lance")) {
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

function normalizeShipName(value) {
  return normalizeText(String(value));
}

function findShipByName(ships, name) {
  const normalized = normalizeShipName(name);
  return ships.find((ship) => normalizeShipName(ship.nom) === normalized) ?? null;
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(getX(left) - getX(right)), Math.abs(getY(left) - getY(right)));
}

function isAdjacent(left, right) {
  return chebyshevDistance(left, right) === 1;
}

function samePosition(left, right) {
  return getX(left) === getX(right) && getY(left) === getY(right);
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

function pickStagingCell(ship, rallyTarget, occupiedCells, cellLookup) {
  const candidates = buildAdjacentCells(rallyTarget).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, cellLookup)
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

function printUsage() {
  console.log("Usage:");
  console.log('npm.cmd run rally -- 5 34 "chasseur 4" "Chasseur 5" "Chasseur M 1" "Chasseur M 3"');
}

async function main() {
  requireConfig();
  acquireLock();

  const args = process.argv.slice(2);
  const rallyX = parseNumber(args[0], NaN);
  const rallyY = parseNumber(args[1], NaN);
  const shipNames = args.slice(2);
  const intervalMs = parseNumber(process.env.RALLY_INTERVAL_MS, 5000);

  if (!Number.isFinite(rallyX) || !Number.isFinite(rallyY) || shipNames.length === 0) {
    printUsage();
    throw new Error("Il faut fournir x, y, puis au moins un nom de vaisseau.");
  }

  const rallyTarget = { x: rallyX, y: rallyY };

  printStatus(`Rally lance vers (${rallyX}, ${rallyY}).`);
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    try {
      const allShips = await getShips();
      const selectedShips = shipNames.map((name) => findShipByName(allShips, name)).filter(Boolean);

      if (selectedShips.length === 0) {
        throw new Error("Aucun vaisseau trouve parmi les noms fournis.");
      }

      let movedShips = 0;
      let arrivedShips = 0;

      for (const ship of selectedShips.sort((left, right) => left.nom.localeCompare(right.nom))) {
        const shipLabel = getShipLabel(ship);

        if (isAdjacent(ship, rallyTarget)) {
          arrivedShips += 1;
          printStatus(`${shipLabel} est deja en position de ralliement.`);
          continue;
        }

        const readyDelay = getShipReadyDelay(ship);

        if (readyDelay > 0) {
          printStatus(`${shipLabel} attend encore ${Math.ceil(readyDelay / 1000)}s`);
          continue;
        }

        const occupiedCells = buildOccupiedCells(allShips, ship.id);
        const shipLookup = await getLocalCellLookup([ship], 1);
        const targetLookup = await getLocalCellLookup([rallyTarget], 1);
        const localLookup = mergeCellLookups(shipLookup, targetLookup);
        const stage = pickStagingCell(ship, rallyTarget, occupiedCells, localLookup);

        if (!stage) {
          printStatus(`${shipLabel} ne trouve pas de case libre autour du point de ralliement.`);
          continue;
        }

        const moveTarget = samePosition(ship, rallyTarget)
          ? stage
          : chooseNextStep(ship, stage, occupiedCells, localLookup);

        if (!moveTarget) {
          printStatus(`${shipLabel} ne trouve pas de pas valide pour se rapprocher.`);
          continue;
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(`${shipLabel} revient au point de ralliement: move (${moveTarget.x}, ${moveTarget.y})`);

        try {
          await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
          movedShips += 1;
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          if (isOccupiedTargetError(error)) {
            printStatus(`${shipLabel} replannifie: la case (${moveTarget.x}, ${moveTarget.y}) est deja occupee`);
            continue;
          }

          printStatus(`${shipLabel} reporte son action: ${error.message}`);
        }
      }

      if (arrivedShips === selectedShips.length) {
        printStatus("Tous les vaisseaux demandes sont rallies.");
        return;
      }

      if (movedShips === 0) {
        printStatus("Aucun mouvement utile ce tour. Nouvelle tentative.");
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
        `Rally reporte: ${error.message}. Nouvelle tentative dans ${Math.ceil(retryDelay / 1000)}s`
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
