import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getEquipes } from "./getEquipes.js";
import { getFullMap } from "./getFullMap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: false });

const API_URL = process.env.API_URL;
const TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;

const LOOP_DELAY_MS = parseNumber(process.env.ATTACK_LOOP_MS, 2000);
const FOCUS_RADIUS = parseNumber(process.env.ATTACK_FOCUS_RADIUS, 8);
const ATTACK_RANGE = parseNumber(process.env.ATTACK_RANGE, 1);
const CONQUER_PLANETS = process.env.ATTACK_CONQUER_PLANETS === "1";

const MY_TEAM_NAME = process.env.MY_TEAM_NAME || "PozClope";
const ALLIED_TEAMS = new Set(
  (process.env.ALLIED_TEAMS || `${MY_TEAM_NAME},Sudo Win`)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
);

const ATTACK_SHIP_IDS = new Set(
  (process.env.ATTACK_SHIP_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

const ATTACK_SHIP_NAMES = new Set(
  (process.env.ATTACK_SHIP_NAMES || "")
    .split(",")
    .map((name) => normalizeText(name))
    .filter(Boolean)
);

const FOCUS_POINTS = parseFocusPoints(process.env.ATTACK_FOCUS_POINTS || "");

const cooldownOverrides = new Map();
const failedMoves = new Map();
let stickyTargetKey = null;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseFocusPoints(rawValue) {
  return String(rawValue)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawX, rawY] = entry.split(":").map((part) => Number(part.trim()));

      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
        return null;
      }

      return { x: rawX, y: rawY };
    })
    .filter(Boolean);
}

function requireConfig() {
  if (!API_URL) {
    throw new Error("API_URL manquant dans .env");
  }

  if (!TOKEN) {
    throw new Error("TOKEN manquant dans .env");
  }

  if (!TEAM_ID) {
    throw new Error("TEAM_ID manquant dans .env");
  }
}

function getDistance(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function getCellKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function getTargetKey(target) {
  return `${target.type}:${target.id ?? getCellKey(target.x, target.y)}`;
}

function getShipLabel(ship) {
  return `${ship.nom} [${String(ship.idVaisseau).slice(0, 6)}]`;
}

function isCombatShip(ship) {
  const shipClass = String(ship?.classe ?? ship?.type ?? "");
  return (
    shipClass.includes("CHASSEUR") ||
    shipClass.includes("CROISEUR") ||
    shipClass.includes("AMIRAL")
  );
}

function hasMeaningfulOwner(value) {
  if (!value) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return Boolean(value.nom || value.identifiant || value.idEquipe || value.id);
}

function getOwnerName(owner, teamLookup) {
  if (!owner) {
    return null;
  }

  if (typeof owner === "string") {
    return teamLookup[owner] || owner;
  }

  return owner.nom || null;
}

function cleanupExpiringMap(store) {
  const now = Date.now();

  for (const [key, until] of store.entries()) {
    if (until <= now) {
      store.delete(key);
    }
  }
}

function parseAvailabilityDate(message) {
  const match = String(message ?? "").match(/(\d{2}):(\d{2}):(\d{2})/);

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

function updateCooldownOverride(shipId, errorMessage) {
  const availabilityDate = parseAvailabilityDate(errorMessage);

  if (!availabilityDate) {
    return;
  }

  cooldownOverrides.set(shipId, availabilityDate.getTime() + 1000);
}

function markFailedMove(shipId, x, y, durationMs = 15000) {
  failedMoves.set(`${shipId},${x},${y}`, Date.now() + durationMs);
}

function isFailedMove(shipId, x, y) {
  const key = `${shipId},${x},${y}`;
  const blockedUntil = failedMoves.get(key);

  if (!blockedUntil) {
    return false;
  }

  if (blockedUntil <= Date.now()) {
    failedMoves.delete(key);
    return false;
  }

  return true;
}

async function apiPost(pathname, body) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    const message = data?.message || data?.error || rawText || `Erreur ${response.status}`;
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    error.details = data ?? rawText;
    throw error;
  }

  return data ?? rawText;
}

async function apiGet(pathname) {
  const response = await fetch(`${API_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json"
    }
  });

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    const message = data?.message || data?.error || rawText || `Erreur ${response.status}`;
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    error.details = data ?? rawText;
    throw error;
  }

  return data ?? rawText;
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function sendShipAction(shipId, action, x, y) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseaux/${shipId}/demander-action`, {
    action,
    coord_x: Number(x),
    coord_y: Number(y)
  });
}

async function getMyShipStates() {
  const payload = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((ship) => ({
    idVaisseau: ship.idVaisseau ?? ship.id,
    nom: ship.nom ?? "Sans nom",
    coord_x: Number(ship.positionX ?? ship.coord_x ?? ship.x ?? 0),
    coord_y: Number(ship.positionY ?? ship.coord_y ?? ship.y ?? 0),
    cooldown: ship.cooldown ?? ship.dateProchaineAction ?? 0,
    pointDeVie: Number(ship.pointDeVie ?? 0),
    proprietaire: ship.proprietaire ?? TEAM_ID,
    classe:
      ship.type?.classeVaisseau ??
      ship.modeleVaisseau?.classeVaisseau ??
      ship.classeVaisseau ??
      ship.type?.nom ??
      "INCONNU",
    type: ship.type?.nom ?? ship.modeleVaisseau?.nom ?? null
  }));
}

function buildTeamLookup(equipes) {
  return Object.fromEntries(equipes.map((equipe) => [equipe.idEquipe, equipe.nom]));
}

function extractShipsFromMap(mapCases, teamLookup) {
  return mapCases
    .filter((cell) => cell.vaisseau)
    .map((cell) => ({
      idVaisseau: cell.vaisseau.idVaisseau,
      nom: cell.vaisseau.nom,
      equipe: teamLookup[cell.vaisseau.proprietaire] || "Inconnu",
      proprietaire: cell.vaisseau.proprietaire,
      coord_x: Number(cell.coord_x),
      coord_y: Number(cell.coord_y),
      pointDeVie: Number(cell.vaisseau.pointDeVie ?? 0),
      type: cell.vaisseau.type?.nom ?? null,
      classe: cell.vaisseau.type?.classeVaisseau ?? null
    }));
}

function mergeMyShips(visibleShips, myShipStates) {
  const byId = new Map(myShipStates.map((ship) => [ship.idVaisseau, ship]));

  return visibleShips.map((ship) => {
    const details = byId.get(ship.idVaisseau);

    if (!details) {
      return {
        ...ship,
        cooldown: 0
      };
    }

    return {
      ...ship,
      coord_x: details.coord_x,
      coord_y: details.coord_y,
      cooldown: details.cooldown,
      pointDeVie: details.pointDeVie || ship.pointDeVie
    };
  });
}

function selectAttackShips(visibleShips, myShipStates) {
  const myVisibleShips = visibleShips.filter((ship) => ship.equipe === MY_TEAM_NAME);
  const mergedShips = mergeMyShips(myVisibleShips, myShipStates).filter(isCombatShip);

  if (ATTACK_SHIP_IDS.size > 0) {
    return mergedShips.filter((ship) => ATTACK_SHIP_IDS.has(ship.idVaisseau));
  }

  if (ATTACK_SHIP_NAMES.size > 0) {
    return mergedShips.filter((ship) => ATTACK_SHIP_NAMES.has(normalizeText(ship.nom)));
  }

  return mergedShips;
}

function getEffectiveCooldownDelay(ship) {
  let delay = 0;

  const rawCooldown = ship.cooldown;

  if (typeof rawCooldown === "number" && Number.isFinite(rawCooldown)) {
    delay = Math.max(rawCooldown * 1000, 0);
  } else if (rawCooldown) {
    const parsed = new Date(rawCooldown);

    if (Number.isFinite(parsed.getTime())) {
      delay = Math.max(parsed.getTime() - Date.now(), 0);
    }
  }

  const override = cooldownOverrides.get(ship.idVaisseau) ?? 0;
  delay = Math.max(delay, override - Date.now());

  if (delay <= 0) {
    cooldownOverrides.delete(ship.idVaisseau);
    return 0;
  }

  return delay;
}

function getFocusDistance(x, y) {
  if (FOCUS_POINTS.length === 0) {
    return 0;
  }

  return Math.min(...FOCUS_POINTS.map((point) => getDistance(x, y, point.x, point.y)));
}

function pickNearestFocusPoint(ship) {
  if (FOCUS_POINTS.length === 0) {
    return null;
  }

  return [...FOCUS_POINTS].sort(
    (left, right) =>
      getDistance(ship.coord_x, ship.coord_y, left.x, left.y) -
      getDistance(ship.coord_x, ship.coord_y, right.x, right.y)
  )[0];
}

function buildTargets(mapCases, visibleShips, teamLookup) {
  const enemyShips = visibleShips
    .filter((ship) => !ALLIED_TEAMS.has(ship.equipe))
    .map((ship) => ({
      id: ship.idVaisseau,
      type: "Vaisseau",
      x: ship.coord_x,
      y: ship.coord_y,
      hp: ship.pointDeVie || 0,
      equipe: ship.equipe,
      focusDistance: getFocusDistance(ship.coord_x, ship.coord_y)
    }));

  const enemyPlanets = mapCases
    .filter((cell) => cell.planete && hasMeaningfulOwner(cell.proprietaire))
    .map((cell) => ({
      id: cell.planete.identifiant,
      type: "Planete",
      x: Number(cell.coord_x),
      y: Number(cell.coord_y),
      hp: Number(cell.planete.pointDeVie ?? 0),
      equipe: getOwnerName(cell.proprietaire, teamLookup),
      capital:
        cell.planete.modules?.some(
          (module) =>
            module?.paramModule?.typeModule === "GOUVERNANCE_PLANETAIRE" ||
            module?.typeModule === "GOUVERNANCE_PLANETAIRE"
        ) ?? false,
      focusDistance: getFocusDistance(cell.coord_x, cell.coord_y)
    }))
    .filter((planet) => planet.equipe && !ALLIED_TEAMS.has(planet.equipe));

  return [...enemyShips, ...enemyPlanets];
}

function isTargetStillValid(target, targets) {
  return targets.some((entry) => getTargetKey(entry) === getTargetKey(target));
}

function scoreTarget(target, myShips) {
  const closestShipDistance = Math.min(
    ...myShips.map((ship) => getDistance(ship.coord_x, ship.coord_y, target.x, target.y))
  );

  const inFocusZone = FOCUS_POINTS.length === 0 || target.focusDistance <= FOCUS_RADIUS;
  let score = 0;

  if (inFocusZone) {
    score += 100000;
  }

  if (target.type === "Vaisseau") {
    score += 30000;
  } else if (!target.capital) {
    score += 8000;
  } else {
    score -= 60000;
  }

  score -= closestShipDistance * 800;
  score -= target.focusDistance * 400;
  score -= target.hp;

  return score;
}

function chooseGlobalTarget(currentTarget, targets, myShips) {
  if (currentTarget && isTargetStillValid(currentTarget, targets)) {
    return currentTarget;
  }

  if (targets.length === 0) {
    return null;
  }

  return [...targets].sort((left, right) => scoreTarget(right, myShips) - scoreTarget(left, myShips))[0];
}

function buildOccupiedSet(mapCases, visibleShips, ignoreShipId = null) {
  const occupied = new Set();

  for (const ship of visibleShips) {
    if (ship.idVaisseau === ignoreShipId) {
      continue;
    }

    occupied.add(getCellKey(ship.coord_x, ship.coord_y));
  }

  for (const cell of mapCases) {
    const terrainType = cell.type?.nom ?? cell.type ?? null;

    if (terrainType === "ASTEROIDE" || terrainType === "Astéroïde") {
      occupied.add(getCellKey(cell.coord_x, cell.coord_y));
    }
  }

  return occupied;
}

function isPassableMove(cell, target = null) {
  if (!cell) {
    return true;
  }

  if (target && cell.coord_x === target.x && cell.coord_y === target.y) {
    return false;
  }

  const terrainType = cell.type?.nom ?? cell.type ?? null;

  if (terrainType === "ASTEROIDE" || terrainType === "Astéroïde") {
    return false;
  }

  if (cell.planete) {
    return false;
  }

  return true;
}

function buildAdjacentCandidates(x, y) {
  const candidates = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const tx = x + dx;
      const ty = y + dy;

      if (tx < 0 || tx >= 58 || ty < 0 || ty >= 58) {
        continue;
      }

      candidates.push({ x: tx, y: ty });
    }
  }

  return candidates;
}

function chooseBestMove(ship, destination, occupiedSet, mapLookup, target = null) {
  const candidates = buildAdjacentCandidates(ship.coord_x, ship.coord_y)
    .filter((candidate) => {
      if (occupiedSet.has(getCellKey(candidate.x, candidate.y))) {
        return false;
      }

      if (isFailedMove(ship.idVaisseau, candidate.x, candidate.y)) {
        return false;
      }

      return isPassableMove(mapLookup.get(getCellKey(candidate.x, candidate.y)), target);
    })
    .sort((left, right) => {
      const leftDistance = getDistance(left.x, left.y, destination.x, destination.y);
      const rightDistance = getDistance(right.x, right.y, destination.x, destination.y);
      return leftDistance - rightDistance;
    });

  return candidates[0] ?? null;
}

function chooseAttackStagingCell(ship, target, occupiedSet, mapLookup) {
  const candidates = buildAdjacentCandidates(target.x, target.y)
    .filter((candidate) => {
      if (occupiedSet.has(getCellKey(candidate.x, candidate.y))) {
        return false;
      }

      return isPassableMove(mapLookup.get(getCellKey(candidate.x, candidate.y)), target);
    })
    .sort((left, right) => {
      const leftDistance = getDistance(ship.coord_x, ship.coord_y, left.x, left.y);
      const rightDistance = getDistance(ship.coord_x, ship.coord_y, right.x, right.y);
      return leftDistance - rightDistance;
    });

  return candidates[0] ?? null;
}

async function actionDeplacer(ship, x, y) {
  try {
    await sendShipAction(ship.idVaisseau, "DEPLACEMENT", x, y);
    log(`${getShipLabel(ship)} se deplace vers (${x}, ${y})`);
    return true;
  } catch (error) {
    updateCooldownOverride(ship.idVaisseau, error.message);

    if (
      error.message.includes("inaccessible") ||
      error.message.includes("obstacle") ||
      error.message.includes("Case cible") ||
      error.message.startsWith("400") ||
      error.message.startsWith("403")
    ) {
      markFailedMove(ship.idVaisseau, x, y);
    }

    log(`${getShipLabel(ship)} deplacement refuse: ${error.message}`);
    return false;
  }
}

async function actionAttaquer(ship, target) {
  try {
    await sendShipAction(ship.idVaisseau, "ATTAQUER", target.x, target.y);
    log(`${getShipLabel(ship)} attaque ${target.type} ${target.equipe} en (${target.x}, ${target.y})`);
    return true;
  } catch (error) {
    updateCooldownOverride(ship.idVaisseau, error.message);
    log(`${getShipLabel(ship)} attaque refusee: ${error.message}`);
    return false;
  }
}

async function actionConquerir(ship, target) {
  try {
    await sendShipAction(ship.idVaisseau, "CONQUERIR", target.x, target.y);
    log(`${getShipLabel(ship)} conquiert ${target.type} en (${target.x}, ${target.y})`);
    return true;
  } catch (error) {
    updateCooldownOverride(ship.idVaisseau, error.message);
    log(`${getShipLabel(ship)} conquete refusee: ${error.message}`);
    return false;
  }
}

async function gererVaisseau(ship, currentTarget, mapCases, visibleShips) {
  const shipLabel = getShipLabel(ship);
  const cooldownDelay = getEffectiveCooldownDelay(ship);

  if (cooldownDelay > 0) {
    log(`${shipLabel} attend encore ${Math.ceil(cooldownDelay / 1000)}s`);
    return false;
  }

  const occupiedSet = buildOccupiedSet(mapCases, visibleShips, ship.idVaisseau);
  const mapLookup = new Map(mapCases.map((cell) => [getCellKey(cell.coord_x, cell.coord_y), cell]));

  if (!currentTarget) {
    const focusPoint = pickNearestFocusPoint(ship);

    if (!focusPoint) {
      log(`${shipLabel} n'a aucune cible ni coordonnee de focus.`);
      return false;
    }

    const move = chooseBestMove(ship, focusPoint, occupiedSet, mapLookup);

    if (!move) {
      log(`${shipLabel} ne trouve aucun chemin vers le focus (${focusPoint.x}, ${focusPoint.y}).`);
      return false;
    }

    return actionDeplacer(ship, move.x, move.y);
  }

  const distanceToTarget = getDistance(ship.coord_x, ship.coord_y, currentTarget.x, currentTarget.y);

  if (distanceToTarget <= ATTACK_RANGE) {
    if (currentTarget.type === "Planete" && currentTarget.hp <= 0 && CONQUER_PLANETS) {
      return actionConquerir(ship, currentTarget);
    }

    return actionAttaquer(ship, currentTarget);
  }

  const stage = chooseAttackStagingCell(ship, currentTarget, occupiedSet, mapLookup);
  const destination = stage ?? { x: currentTarget.x, y: currentTarget.y };
  const move = chooseBestMove(ship, destination, occupiedSet, mapLookup, currentTarget);

  if (!move) {
    log(`${shipLabel} est bloque autour de (${ship.coord_x}, ${ship.coord_y}).`);
    return false;
  }

  return actionDeplacer(ship, move.x, move.y);
}

async function main() {
  requireConfig();

  if (FOCUS_POINTS.length === 0) {
    log("Aucune coordonnee de focus configuree. Ajoute ATTACK_FOCUS_POINTS=x:y,x:y dans le .env.");
  } else {
    log(`Focus trade: ${FOCUS_POINTS.map((point) => `(${point.x},${point.y})`).join(" ")}`);
  }

  while (true) {
    cleanupExpiringMap(cooldownOverrides);
    cleanupExpiringMap(failedMoves);

    const equipes = await getEquipes();
    const teamLookup = buildTeamLookup(equipes);
    const mapCases = await getFullMap();
    const visibleShips = extractShipsFromMap(mapCases, teamLookup);
    const myShipStates = await getMyShipStates();
    const attackShips = selectAttackShips(visibleShips, myShipStates);
    const targets = buildTargets(mapCases, visibleShips, teamLookup);
    const currentTarget = chooseGlobalTarget(
      targets.find((target) => getTargetKey(target) === stickyTargetKey) ?? null,
      targets,
      attackShips
    );

    stickyTargetKey = currentTarget ? getTargetKey(currentTarget) : null;

    log("--- Nouveau tour ---");
    log(`Flotte d'attaque: ${attackShips.map((ship) => getShipLabel(ship)).join(", ") || "aucune"}`);

    if (currentTarget) {
      log(
        `Focus: ${currentTarget.type} ${currentTarget.equipe} en (${currentTarget.x}, ${currentTarget.y}) | HP ${currentTarget.hp} | distance focus ${currentTarget.focusDistance}`
      );
    } else {
      log("Aucune cible ennemie visible. Deplacement vers la zone de trade.");
    }

    if (attackShips.length === 0) {
      log("Aucun vaisseau de combat selectionne.");
      await sleep(LOOP_DELAY_MS);
      continue;
    }

    const results = await Promise.all(
      attackShips.map((ship) => gererVaisseau(ship, currentTarget, mapCases, visibleShips))
    );

    if (!results.some(Boolean)) {
      log("Aucune action utile ce tour.");
    }

    await sleep(LOOP_DELAY_MS);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
