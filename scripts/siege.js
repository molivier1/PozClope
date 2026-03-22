const {
  getMap,
  getShips,
  getTeamState,
  normalizeText,
  requireConfig,
  sendShipAction
} = require("./game");

const MAP_SIZE = 58;

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

function buildTarget(x, y) {
  return { x: Number(x), y: Number(y) };
}

function buildRange(target, ships, padding = 3) {
  const xs = [getX(target), ...ships.map((ship) => getX(ship))];
  const ys = [getY(target), ...ships.map((ship) => getY(ship))];

  return {
    xMin: Math.max(0, Math.min(...xs) - padding),
    xMax: Math.min(MAP_SIZE - 1, Math.max(...xs) + padding),
    yMin: Math.max(0, Math.min(...ys) - padding),
    yMax: Math.min(MAP_SIZE - 1, Math.max(...ys) + padding)
  };
}

function buildCellLookup(cells) {
  const lookup = new Map();

  for (const cell of cells) {
    lookup.set(getCellKey(cell.coord_x, cell.coord_y), cell);
  }

  return lookup;
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
  return isPassableCell(cell);
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

function pickStagingCell(ship, target, occupiedCells, lookup, ships = []) {
  const candidates = buildAdjacentCells(target).filter(
    (cell) =>
      !isOccupiedCell(cell.x, cell.y, occupiedCells) &&
      isPassableCoord(cell.x, cell.y, lookup)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftBlockingScore = getSlotBlockingScore(left, ships, target, ship.id);
    const rightBlockingScore = getSlotBlockingScore(right, ships, target, ship.id);

    if (leftBlockingScore !== rightBlockingScore) {
      return leftBlockingScore - rightBlockingScore;
    }

    const leftPathDistance = getPathDistance(ship, left, occupiedCells, lookup);
    const rightPathDistance = getPathDistance(ship, right, occupiedCells, lookup);

    if (leftPathDistance !== rightPathDistance) {
      return leftPathDistance - rightPathDistance;
    }

    const leftScore = chebyshevDistance(ship, left);
    const rightScore = chebyshevDistance(ship, right);
    return leftScore - rightScore;
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
    message.includes("La planète a encore des points de vies")
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

function isAsteroidPlanet(cell) {
  const planetType = String(cell?.planete?.typePlanete ?? "").toUpperCase();
  return planetType.includes("ASTERO");
}

function printUsage() {
  console.log("Usage:");
  console.log('npm.cmd run siege -- 11 47 "HyperCESIssable"');
  console.log('npm.cmd run siege -- 11 47 "HyperCESIssable" "BuveurDePisse"');
  console.log("Optionnel:");
  console.log("  SIEGE_INTERVAL_MS=5000");
  console.log("  SIEGE_TARGET_HP=0");
}

async function main() {
  requireConfig();

  const [xArg, yArg, ...shipNames] = process.argv.slice(2);
  const targetX = Number(xArg);
  const targetY = Number(yArg);

  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    printUsage();
    process.exit(1);
  }

  const intervalMs = parseNumber(process.env.SIEGE_INTERVAL_MS, 5000);
  const targetHp = parseNumber(process.env.SIEGE_TARGET_HP, 0);
  const target = buildTarget(targetX, targetY);

  printStatus(
    `Siege lance sur (${targetX}, ${targetY}) | seuil conquete ${targetHp} PV`
  );
  printStatus("Ctrl + C pour arreter.");

  while (true) {
    const cycleStartedAt = Date.now();

    try {
      const [allShips, team] = await Promise.all([getShips(), getTeamState()]);
      const attackShips =
        shipNames.length > 0
          ? shipNames
              .map((name) => findShipByName(allShips, name))
              .filter(Boolean)
          : allShips.filter((ship) => String(ship.classe).includes("CHASSEUR"));

      if (attackShips.length === 0) {
        throw new Error("Aucun vaisseau d'assaut disponible.");
      }

      const range = buildRange(target, attackShips, 3);
      const cells = await getMap(range.xMin, range.xMax, range.yMin, range.yMax);
      const cellLookup = buildCellLookup(cells);
      const targetCell = cellLookup.get(getCellKey(targetX, targetY));

      if (!targetCell?.planete) {
        printStatus(
          `Cible (${targetX}, ${targetY}) hors vision actuelle, approche sur coordonnees.`
        );

        const occupiedCells = new Set(
          allShips.map((ship) => getCellKey(getX(ship), getY(ship)))
        );
        let actionDone = false;

        for (const ship of attackShips.sort((left, right) => left.nom.localeCompare(right.nom))) {
          const readyDelay = getShipReadyDelay(ship);

          if (readyDelay > 0) {
            printStatus(`${ship.nom} attend encore ${Math.ceil(readyDelay / 1000)}s`);
            continue;
          }

          occupiedCells.delete(getCellKey(getX(ship), getY(ship)));
          const moveTarget = chooseNextStep(ship, target, occupiedCells, cellLookup);

          if (!moveTarget) {
            continue;
          }

          reserveCell(occupiedCells, moveTarget);
          printStatus(`${ship.nom} avance vers la zone: move (${moveTarget.x}, ${moveTarget.y})`);
          await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
          actionDone = true;
          break;
        }

        await sleep(
          getCycleSleepDelay(
            cycleStartedAt,
            actionDone ? intervalMs : Math.max(intervalMs, 3000)
          )
        );
        continue;
      }

      if (isAsteroidPlanet(targetCell)) {
        printStatus(
          `${targetCell.planete.nom} (${targetX}, ${targetY}) est un champ d'asteroides, non capturable. Siege arrete.`
        );
        return;
      }

      if (targetOwnedByTeam(team, targetCell)) {
        printStatus(
          `${targetCell.planete.nom} est deja a vous. Siege termine.`
        );
        return;
      }

      printStatus(
        `Cible ${targetCell.planete.nom} | proprio ${targetCell.proprietaire?.nom ?? "aucun"} | PV ${targetCell.planete.pointDeVie}`
      );

      const occupiedCells = new Set(
        allShips.map((ship) => getCellKey(getX(ship), getY(ship)))
      );
      const claimShip =
        [...attackShips]
          .sort((left, right) => getShipReadyDelay(left) - getShipReadyDelay(right))
          .find((ship) => true) ?? attackShips[0];
      let actionDone = false;

      if (Number(targetCell.planete.pointDeVie ?? 0) <= targetHp) {
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
          printStatus(`${claimShip.nom} tente CONQUERIR sur (${targetX}, ${targetY})`);
          await sendShipAction(claimShip.id, "CONQUERIR", targetX, targetY);
          await sleep(getCycleSleepDelay(cycleStartedAt, intervalMs));
          continue;
        }

        const claimStage = pickStagingCell(
          claimShip,
          target,
          occupiedCells,
          cellLookup,
          attackShips
        );

        if (!claimStage) {
          throw new Error("Aucune case libre pour approcher la conquete.");
        }

        const moveTarget = chooseNextStep(claimShip, claimStage, occupiedCells, cellLookup);

        if (!moveTarget) {
          throw new Error("Aucun chemin libre pour le vaisseau de conquete.");
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(
          `${claimShip.nom} se positionne pour conquerir: move (${moveTarget.x}, ${moveTarget.y})`
        );
        await sendShipAction(claimShip.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        await sleep(getCycleSleepDelay(cycleStartedAt, intervalMs));
        continue;
      }

      for (const ship of attackShips.sort((left, right) => left.nom.localeCompare(right.nom))) {
        const readyDelay = getShipReadyDelay(ship);

        if (readyDelay > 0) {
          printStatus(
            `${ship.nom} attend encore ${Math.ceil(readyDelay / 1000)}s`
          );
          continue;
        }

        occupiedCells.delete(getCellKey(getX(ship), getY(ship)));

        if (isAdjacent(ship, target)) {
          const sidestepCell = chooseRangeAdjustmentCell(
            ship,
            target,
            attackShips,
            occupiedCells,
            cellLookup
          );

          if (sidestepCell) {
            reserveCell(occupiedCells, sidestepCell);
            printStatus(
              `${ship.nom} se decale pour liberer l'approche: move (${sidestepCell.x}, ${sidestepCell.y})`
            );
            await sendShipAction(ship.id, "DEPLACEMENT", sidestepCell.x, sidestepCell.y);
            actionDone = true;
            break;
          }

          printStatus(`${ship.nom} attaque (${targetX}, ${targetY})`);
          await sendShipAction(ship.id, "ATTAQUER", targetX, targetY);
          actionDone = true;
          break;
        }

        const stage = pickStagingCell(ship, target, occupiedCells, cellLookup, attackShips);

        if (!stage) {
          throw new Error("Aucune case libre autour de la cible.");
        }

        const moveTarget = chooseNextStep(ship, stage, occupiedCells, cellLookup);

        if (!moveTarget) {
          throw new Error(`Aucun chemin libre pour ${ship.nom}.`);
        }

        reserveCell(occupiedCells, moveTarget);
        printStatus(`${ship.nom} approche la cible: move (${moveTarget.x}, ${moveTarget.y})`);
        await sendShipAction(ship.id, "DEPLACEMENT", moveTarget.x, moveTarget.y);
        actionDone = true;
        break;
      }

      await sleep(
        getCycleSleepDelay(
          cycleStartedAt,
          actionDone ? intervalMs : Math.max(intervalMs, 3000)
        )
      );
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
