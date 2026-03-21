const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const dotenv = require("dotenv");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ENV_PATHS = [
  path.join(ROOT_DIR, ".env"),
  path.join(ROOT_DIR, "Backend", ".env")
];
const MAP_SIZE = 58;
const DEFAULT_PADDING = 6;
const DEFAULT_RANGE = {
  x: [0, 15],
  y: [40, 50]
};
const LEADERBOARD_CANDIDATE_PATHS = [
  "/equipes/classement",
  "/classement",
  "/leaderboard",
  "/scoreboard",
  "/equipes/leaderboard",
  "/equipes/scores",
  "/scores",
  "/equipes"
];

for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
    break;
  }
}

const PORT = Number(process.env.PORT || 3000);
const API_URL = process.env.API_URL;
const STATIC_TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;
const STATIC_TOKEN_METADATA = decodeJwtPayload(STATIC_TOKEN);
const DERIVED_AUTH_CONFIG = deriveAuthConfig(STATIC_TOKEN_METADATA);
const AUTH_BASE_URL =
  process.env.KEYCLOAK_URL ??
  process.env.AUTH_URL ??
  DERIVED_AUTH_CONFIG.baseUrl ??
  null;
const AUTH_REALM =
  process.env.KEYCLOAK_REALM ?? DERIVED_AUTH_CONFIG.realm ?? null;
const AUTH_CLIENT_ID =
  process.env.KEYCLOAK_CLIENT_ID ??
  DERIVED_AUTH_CONFIG.clientId ??
  "vaissals-backend";
const AUTH_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? null;
const AUTH_USERNAME =
  process.env.KEYCLOAK_USERNAME ?? DERIVED_AUTH_CONFIG.username ?? null;
const AUTH_PASSWORD = process.env.KEYCLOAK_PASSWORD ?? null;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 25_000;

const app = express();
let cachedLeaderboardPath = null;
const authState = {
  accessToken: STATIC_TOKEN ?? null,
  accessTokenExpMs: getTokenExpiryMs(STATIC_TOKEN),
  refreshToken: null,
  refreshTokenExpMs: 0,
  accessTokenPromise: null
};

let cachedFullMap = [];
let isFetchingMap = false;

async function refreshFullMap() {
  if (isFetchingMap || !API_URL) return;
  isFetchingMap = true;
  try {
    const chunkSize = 18;
    const fullMap = [];
    for (let y = 0; y < MAP_SIZE; y += chunkSize) {
      for (let x = 0; x < MAP_SIZE; x += chunkSize) {
        const xEnd = Math.min(x + chunkSize - 1, MAP_SIZE - 1);
        const yEnd = Math.min(y + chunkSize - 1, MAP_SIZE - 1);
        const response = await authorizedFetch(`/monde/map?x_range=${x},${xEnd}&y_range=${y},${yEnd}`);
        if (response.ok) {
          const payload = await response.json();
          fullMap.push(...extractArray(payload));
        }
      }
    }
    if (fullMap.length > 0) {
      cachedFullMap = fullMap.map(normalizeCell).filter(Boolean);
    }
  } catch (err) {
    console.error("Map chunk refresh failed:", err.message);
  } finally {
    isFetchingMap = false;
  }
}

// Cache the full map in the background to avoid Game API timeouts on large ranges
setTimeout(refreshFullMap, 2000);
setInterval(refreshFullMap, 60000);

function getScore(entry) {
  if (!entry.ressources) return 0;

  const res = entry.ressources.find(
    r => r.ressource?.nom === "POINT"
  );

  return res ? res.quantite : 0;
}

function decodeJwtPayload(token) {
  if (!token) {
    return null;
  }

  try {
    const parts = token.split(".");

    if (parts.length < 2) {
      return null;
    }

    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
  } catch (error) {
    return null;
  }
}

function getTokenExpiryMs(token) {
  const payload = decodeJwtPayload(token);
  const expiresAt = Number(payload?.exp);

  return Number.isFinite(expiresAt) ? expiresAt * 1000 : 0;
}

function deriveAuthConfig(payload) {
  if (!payload) {
    return {};
  }

  let baseUrl = null;
  let realm = null;

  if (typeof payload.iss === "string") {
    try {
      const issuerUrl = new URL(payload.iss);
      const marker = "/realms/";
      const markerIndex = issuerUrl.pathname.indexOf(marker);

      if (markerIndex >= 0) {
        const basePath = issuerUrl.pathname.slice(0, markerIndex);
        const realmPath = issuerUrl.pathname.slice(markerIndex + marker.length);

        realm = realmPath.split("/")[0] || null;
        baseUrl = `${issuerUrl.origin}${basePath}`;
      } else {
        baseUrl = issuerUrl.origin;
      }
    } catch (error) {
      baseUrl = null;
      realm = null;
    }
  }

  return {
    baseUrl,
    realm,
    clientId: payload.azp ?? null,
    username: payload.preferred_username ?? null
  };
}

function missingConfig() {
  const missing = [];

  if (!API_URL) {
    missing.push("API_URL");
  }
  if (!TEAM_ID) {
    missing.push("TEAM_ID");
  }
  if (!STATIC_TOKEN && !hasPasswordGrantConfig()) {
    missing.push("TOKEN ou KEYCLOAK_USERNAME/KEYCLOAK_PASSWORD");
  }

  return missing;
}

function extractArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.teams)) {
    return payload.teams;
  }
  if (Array.isArray(payload?.equipes)) {
    return payload.equipes;
  }
  if (Array.isArray(payload?.leaderboard)) {
    return payload.leaderboard;
  }
  if (Array.isArray(payload?.classement)) {
    return payload.classement;
  }
  if (Array.isArray(payload?.content)) {
    return payload.content;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.result)) {
    return payload.result;
  }
  return [];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampRange(range) {
  const start = clamp(range[0], 0, MAP_SIZE - 1);
  const end = clamp(range[1], 0, MAP_SIZE - 1);
  return start <= end ? [start, end] : [end, start];
}

function parseRange(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }

  const parts = String(rawValue)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (parts.length !== 2) {
    return fallback;
  }

  return clampRange(parts);
}

function pickCoord(entity, axis) {
  const coordKey = `coord_${axis}`;
  const camelKey = `coord${axis.toUpperCase()}`;
  const positionKey = `position${axis.toUpperCase()}`;
  const direct = entity?.[coordKey];
  const loose = entity?.[axis];
  const nested = entity?.position?.[coordKey] ?? entity?.position?.[axis];
  const camel = entity?.[camelKey];
  const positioned = entity?.[positionKey];
  const value = direct ?? loose ?? nested ?? camel ?? positioned;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeOwner(owner) {
  if (!owner) {
    return null;
  }

  return {
    identifiant: owner.identifiant ?? owner.id ?? null,
    nom: owner.nom ?? owner.name ?? null
  };
}

function normalizePlanet(planet) {
  if (!planet) {
    return null;
  }

  const typePlanete = planet.modelePlanete?.typePlanete ?? planet.typePlanete ?? null;
  const biome = planet.modelePlanete?.biome ?? planet.biome ?? null;

  return {
    identifiant: planet.identifiant ?? planet.id ?? null,
    nom: planet.nom ?? "Planete inconnue",
    description: planet.description ?? "",
    coord_x: pickCoord(planet, "x"),
    coord_y: pickCoord(planet, "y"),
    mineraiDisponible: Number(planet.mineraiDisponible ?? 0),
    pointDeVie: Number(planet.pointDeVie ?? 0),
    slotsConstruction: Number(planet.slotsConstruction ?? 0),
    biome,
    typePlanete,
    estVide: String(typePlanete).toUpperCase() === "VIDE",
    modules: Array.isArray(planet.modules) ? planet.modules : []
  };
}

function normalizeCell(cell) {
  const x = pickCoord(cell, "x");
  const y = pickCoord(cell, "y");

  if (x === null || y === null) {
    return null;
  }

  return {
    coord_x: x,
    coord_y: y,
    proprietaire: normalizeOwner(cell.proprietaire),
    planete: normalizePlanet(cell.planete ?? cell.planet ?? null),
    vaisseaux: extractArray(cell.vaisseaux ?? cell.ships).map((v, index) => normalizeShip(v, index)).filter(Boolean)
  };
}

function normalizeShip(ship, index) {
  const x = pickCoord(ship, "x");
  const y = pickCoord(ship, "y");

  if (x === null || y === null) {
    return null;
  }

  return {
    identifiant: ship.identifiant ?? ship.idVaisseau ?? ship.id ?? `ship-${index}`,
    nom: ship.nom ?? ship.name ?? `Vaisseau ${index + 1}`,
    proprietaire: normalizeOwner(ship.proprietaire),
    typeId: ship.modeleVaisseau?.id ?? ship.type?.id ?? null,
    type: ship.modeleVaisseau?.nom ?? ship.type?.nom ?? ship.type ?? null,
    classeVaisseau:
      ship.modeleVaisseau?.classeVaisseau ??
      ship.type?.classeVaisseau ??
      null,
    coord_x: x,
    coord_y: y,
    pointDeVie: Number(ship.pointDeVie ?? 0),
    vitesse: Number(ship.vitesse ?? 0),
    mineraiTransporte: Number(ship.mineraiTransporte ?? 0),
    capaciteTransport: Number(
      ship.modeleVaisseau?.capaciteTransport ?? ship.type?.capaciteTransport ?? 0
    ),
    attaque: Number(ship.modeleVaisseau?.attaque ?? ship.type?.attaque ?? 0),
    coutConstruction: Number(
      ship.modeleVaisseau?.coutConstruction ?? ship.type?.coutConstruction ?? 0
    ),
    dateProchaineAction: ship.dateProchaineAction ?? null
  };
}

function normalizeConstructibleType(type) {
  if (!type) {
    return null;
  }

  return {
    identifiant: type.id ?? type.identifiant ?? null,
    nom: type.nom ?? type.name ?? null,
    classeVaisseau: type.classeVaisseau ?? null,
    coutConstruction: Number(type.coutConstruction ?? 0),
    capaciteTransport: Number(type.capaciteTransport ?? 0),
    attaque: Number(type.attaque ?? 0),
    pointDeVie: Number(type.pointDeVie ?? 0),
    vitesse: Number(type.vitesse ?? 0)
  };
}

function normalizeModule(module) {
  if (!module) {
    return null;
  }

  const paramModule = module.paramModule ?? {};

  return {
    identifiant: module.id ?? module.identifiant ?? null,
    idPlanete: module.idPlanete ?? null,
    proprietaire: module.proprietaire ?? null,
    pointDeVie: Number(paramModule.pointDeVie ?? 0),
    attaque: Number(paramModule.attaque ?? 0),
    nombreSlotsOccupes: Number(paramModule.nombreSlotsOccupes ?? 0),
    typeModule: paramModule.typeModule ?? null,
    asset: paramModule.asset ?? null,
    listeVaisseauxConstructible: extractArray(
      paramModule.listeVaisseauxConstructible
    )
      .map(normalizeConstructibleType)
      .filter(Boolean)
  };
}

function normalizeTeamResource(resourceEntry) {
  if (!resourceEntry) {
    return null;
  }

  return {
    identifiant:
      resourceEntry.ressource?.idRessource ??
      resourceEntry.ressource?.id ??
      null,
    nom: resourceEntry.ressource?.nom ?? null,
    type: resourceEntry.ressource?.type ?? null,
    description: resourceEntry.ressource?.description ?? "",
    quantite: Number(resourceEntry.quantite ?? 0)
  };
}

function normalizeOwnedPlanet(planet) {
  const normalized = normalizePlanet(planet);

  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    modules: extractArray(planet?.modules).map(normalizeModule).filter(Boolean)
  };
}

function normalizeTeam(team) {
  return {
    identifiant: team?.idEquipe ?? team?.identifiant ?? null,
    nom: team?.nom ?? "Equipe inconnue",
    type: team?.type ?? null,
    nombreSlotVaisseaux: Number(team?.nombreSlotVaisseaux ?? 0),
    ressources: extractArray(team?.ressources)
      .map(normalizeTeamResource)
      .filter(Boolean),
    planetes: extractArray(team?.planetes)
      .map(normalizeOwnedPlanet)
      .filter(Boolean),
    modules: extractArray(team?.modules)
      .map(normalizeModule)
      .filter(Boolean)
  };
}

function normalizeShipName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getActiveShipNameSet(teamPayload) {
  return new Set(
    extractArray(teamPayload?.vaisseaux)
      .map((ship) => ship?.nom)
      .filter(Boolean)
      .map((name) => normalizeShipName(name))
  );
}

function filterActiveShips(ships, teamPayload) {
  const activeNames = getActiveShipNameSet(teamPayload);

  if (activeNames.size === 0) {
    return ships;
  }

  return ships.filter((ship) => activeNames.has(normalizeShipName(ship.nom)));
}

function isTokenUsable(expiresAtMs, skewMs = TOKEN_REFRESH_SKEW_MS) {
  return Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > skewMs;
}

function hasPasswordGrantConfig() {
  return Boolean(
    AUTH_BASE_URL &&
      AUTH_REALM &&
      AUTH_CLIENT_ID &&
      AUTH_USERNAME &&
      AUTH_PASSWORD
  );
}

function hasRefreshGrantConfig() {
  return Boolean(
    AUTH_BASE_URL &&
      AUTH_REALM &&
      AUTH_CLIENT_ID &&
      authState.refreshToken &&
      isTokenUsable(authState.refreshTokenExpMs, 0)
  );
}

function canRefreshAuth() {
  return hasRefreshGrantConfig() || hasPasswordGrantConfig();
}

function getAuthMode() {
  if (hasPasswordGrantConfig()) {
    return "keycloak-password-grant";
  }

  if (STATIC_TOKEN) {
    return "static-token";
  }

  return "missing-auth";
}

function getTokenEndpointUrl() {
  if (!AUTH_BASE_URL || !AUTH_REALM) {
    return null;
  }

  return `${AUTH_BASE_URL}/realms/${AUTH_REALM}/protocol/openid-connect/token`;
}

function setAuthTokens(tokenPayload) {
  authState.accessToken = tokenPayload.access_token ?? authState.accessToken;
  authState.accessTokenExpMs = getTokenExpiryMs(authState.accessToken);

  if (tokenPayload.refresh_token) {
    authState.refreshToken = tokenPayload.refresh_token;
    authState.refreshTokenExpMs = getTokenExpiryMs(authState.refreshToken);
  }
}

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function describeFetchError(error) {
  const code = error?.cause?.code ?? error?.code ?? null;

  if (code === "UND_ERR_CONNECT_TIMEOUT") {
    return "timeout de connexion";
  }
  if (code === "ECONNREFUSED") {
    return "connexion refusee";
  }
  if (code === "ENOTFOUND") {
    return "hote introuvable";
  }
  if (error?.name === "AbortError") {
    return "timeout de requete";
  }

  return error?.message ?? "erreur reseau";
}

async function performFetch(url, options, contextLabel) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw createHttpError(
      `${contextLabel}: ${describeFetchError(error)}`,
      502
    );
  }
}

async function requestToken(formData) {
  const tokenEndpoint = getTokenEndpointUrl();

  if (!tokenEndpoint) {
    throw createHttpError(
      "Configuration Keycloak incomplete. Ajoute AUTH_URL/KEYCLOAK_URL et KEYCLOAK_REALM.",
      500
    );
  }

  if (!AUTH_CLIENT_ID) {
    throw createHttpError(
      "Configuration Keycloak incomplete. Ajoute KEYCLOAK_CLIENT_ID.",
      500
    );
  }

  const payload = new URLSearchParams({
    client_id: AUTH_CLIENT_ID,
    ...formData
  });

  if (AUTH_CLIENT_SECRET) {
    payload.set("client_secret", AUTH_CLIENT_SECRET);
  }

  const response = await performFetch(
    tokenEndpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload
    },
    "Impossible de joindre Keycloak"
  );
  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
  }

  if (!response.ok) {
    throw createHttpError(
      `Echec recuperation token Keycloak (${response.status}).`,
      response.status
    );
  }

  if (!json?.access_token) {
    throw createHttpError("Keycloak n'a pas retourne d'access_token.", 500);
  }

  setAuthTokens(json);
  return authState.accessToken;
}

async function refreshAccessToken(forceRefresh) {
  if (!forceRefresh && isTokenUsable(authState.accessTokenExpMs)) {
    return authState.accessToken;
  }

  if (hasRefreshGrantConfig()) {
    try {
      return await requestToken({
        grant_type: "refresh_token",
        refresh_token: authState.refreshToken
      });
    } catch (error) {
      authState.refreshToken = null;
      authState.refreshTokenExpMs = 0;
    }
  }

  if (hasPasswordGrantConfig()) {
    return requestToken({
      grant_type: "password",
      username: AUTH_USERNAME,
      password: AUTH_PASSWORD
    });
  }

  if (
    authState.accessToken &&
    !forceRefresh &&
    isTokenUsable(authState.accessTokenExpMs, 0)
  ) {
    return authState.accessToken;
  }

  if (STATIC_TOKEN && !AUTH_PASSWORD) {
    throw createHttpError(
      "TOKEN expire. Ajoute KEYCLOAK_USERNAME et KEYCLOAK_PASSWORD dans .env pour le renouveler automatiquement.",
      401
    );
  }

  throw createHttpError(
    "Configuration d'authentification incomplete. Ajoute KEYCLOAK_USERNAME et KEYCLOAK_PASSWORD dans .env.",
    401
  );
}

async function ensureAccessToken(options = {}) {
  const { forceRefresh = false } = options;

  if (!forceRefresh && isTokenUsable(authState.accessTokenExpMs)) {
    return authState.accessToken;
  }

  if (!authState.accessTokenPromise) {
    authState.accessTokenPromise = refreshAccessToken(forceRefresh).finally(() => {
      authState.accessTokenPromise = null;
    });
  }

  return authState.accessTokenPromise;
}

async function authorizedFetch(pathname, options = {}) {
  const { retryUnauthorized = true } = options;
  const accessToken = await ensureAccessToken();
  let response = await performFetch(
    `${API_URL}${pathname}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    },
    `Impossible de joindre l'API du jeu sur ${pathname}`
  );

  if (response.status === 401 && retryUnauthorized && canRefreshAuth()) {
    authState.accessToken = null;
    authState.accessTokenExpMs = 0;
    authState.accessTokenPromise = null;

    const refreshedToken = await ensureAccessToken({ forceRefresh: true });

    response = await performFetch(
      `${API_URL}${pathname}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${refreshedToken}`
        }
      },
      `Impossible de joindre l'API du jeu sur ${pathname}`
    );
  }

  return response;
}

function pickNestedValue(entity, keys) {
  let queue = [entity];

  for (let depth = 0; depth < 2; depth += 1) {
    const nextQueue = [];

    for (const current of queue) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        continue;
      }

      for (const key of keys) {
        const value = current[key];

        if (value !== undefined && value !== null && value !== "") {
          return value;
        }
      }

      for (const value of Object.values(current)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          nextQueue.push(value);
        }
      }
    }

    queue = nextQueue;
  }

  return null;
}

function collectArrays(payload, depth = 0) {
  if (!payload || typeof payload !== "object" || depth > 2) {
    return [];
  }

  const arrays = [];

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      arrays.push(value);
      continue;
    }

    if (value && typeof value === "object") {
      arrays.push(...collectArrays(value, depth + 1));
    }
  }

  return arrays;
}

function normalizeLeaderboardEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  let score = Number(
    pickNestedValue(entry, [
      "score",
      "points",
      "point",
      "nbPoints",
      "totalPoints",
      "scoreTotal",
      "pointsVictoire",
      "victoryPoints"
    ])
  );

  // Fallback if score wasn't found directly (Number(null) === 0)
  if ((!Number.isFinite(score) || score === 0) && Array.isArray(entry.ressources)) {
    const pointRes = entry.ressources.find(r => r.ressource?.nom === "POINT");
    if (pointRes && pointRes.quantite !== undefined) {
      score = Number(pointRes.quantite);
    }
  }

  if (!Number.isFinite(score)) {
    return null;
  }

  const identifiant = pickNestedValue(entry, [
    "identifiant",
    "id",
    "idEquipe",
    "teamId"
  ]);
  const nom = pickNestedValue(entry, [
    "nom",
    "name",
    "nomEquipe",
    "teamName",
    "label"
  ]);
  const rang = Number(
    pickNestedValue(entry, ["rang", "rank", "position", "classement"])
  );

  return {
    identifiant:
      identifiant === null || identifiant === undefined
        ? null
        : String(identifiant),
    nom: typeof nom === "string" && nom.trim() ? nom.trim() : `Equipe ${index + 1}`,
    score,
    rang: Number.isFinite(rang) ? rang : index + 1,
    isCurrentTeam: String(identifiant ?? "") === TEAM_ID
  };
}

function extractLeaderboard(payload) {
  const candidates = [extractArray(payload), ...collectArrays(payload)];
  let bestMatch = [];

  for (const candidate of candidates) {
    const normalized = candidate
      .map(normalizeLeaderboardEntry)
      .filter(Boolean);

    if (normalized.length > bestMatch.length) {
      bestMatch = normalized;
    }
  }

  return bestMatch
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.rang !== right.rang) {
        return left.rang - right.rang;
      }

      return left.nom.localeCompare(right.nom, "fr");
    })
    .map((entry, index) => ({
      ...entry,
      rang: index + 1
    }));
}

function manhattanDistance(from, to) {
  return Math.abs(from.coord_x - to.coord_x) + Math.abs(from.coord_y - to.coord_y);
}

function getFleetCenter(ships) {
  if (!ships.length) {
    return null;
  }

  const total = ships.reduce(
    (accumulator, ship) => ({
      x: accumulator.x + ship.coord_x,
      y: accumulator.y + ship.coord_y
    }),
    { x: 0, y: 0 }
  );

  return {
    coord_x: total.x / ships.length,
    coord_y: total.y / ships.length
  };
}

function getNearestPoint(origin, points) {
  if (!points.length) {
    return null;
  }

  return points.reduce((bestMatch, point) => {
    const distance = manhattanDistance(origin, point);

    if (!bestMatch || distance < bestMatch.distance) {
      return {
        point,
        distance
      };
    }

    return bestMatch;
  }, null);
}

function getResourceQuantity(team, resourceName) {
  return (
    team.ressources.find((resource) => resource.nom === resourceName)?.quantite ?? 0
  );
}

function getAllConstructibleTypes(planets) {
  const seenIds = new Set();
  const types = [];

  for (const planet of planets) {
    for (const module of planet.modules) {
      if (
        module.typeModule !== "CONSTRUCTION_VAISSEAUX" &&
        module.typeModule !== "CONSTRUCTION_VAISSEAUX_AVANCEE"
      ) {
        continue;
      }

      for (const type of module.listeVaisseauxConstructible) {
        const key = type.identifiant ?? type.classeVaisseau ?? type.nom;

        if (!key || seenIds.has(key)) {
          continue;
        }

        seenIds.add(key);
        types.push(type);
      }
    }
  }

  return types;
}

function getShipRole(ship, context) {
  if (ship.classeVaisseau?.includes("CARGO")) {
    return "transport";
  }

  if (!context.hasCargo && ship.attaque > 0) {
    return ship.nom === context.primaryMiner?.nom ? "collecte-courte" : "escorte";
  }

  return ship.attaque > 0 ? "escorte" : "reconnaissance";
}

function scoreEconomyTarget(target, context) {
  const mineralsScore = target.planete.mineraiDisponible / 60;
  const slotsScore = target.planete.slotsConstruction * 18;
  const neutralityScore =
    target.ownerStatus === "neutral" ? 90 : target.ownerStatus === "owned" ? 35 : -120;
  const shipDistancePenalty = target.nearestShipDistance * 22;
  const depositDistancePenalty = target.nearestDepositDistance * 14;
  const shipCountBonus = target.nearestShipDistance <= 2 ? 30 : 0;
  const claimBonus =
    target.ownerStatus === "neutral" && target.planete.slotsConstruction >= 4 ? 40 : 0;

  return Math.round(
    mineralsScore +
      slotsScore +
      neutralityScore +
      shipCountBonus +
      claimBonus -
      shipDistancePenalty -
      depositDistancePenalty
  );
}

function buildEconomyPlan(team, ships, cells, range) {
  const depositPlanets = team.planetes.filter((planet) =>
    planet.modules.some((module) => module.typeModule === "DECHARGEMENT_RESSOURCE")
  );
  const shipyardPlanets = team.planetes.filter((planet) =>
    planet.modules.some(
      (module) =>
        module.typeModule === "CONSTRUCTION_VAISSEAUX" ||
        module.typeModule === "CONSTRUCTION_VAISSEAUX_AVANCEE"
    )
  );
  const constructibleTypes = getAllConstructibleTypes(team.planetes);
  const fleetCenter = getFleetCenter(ships);
  const nearestHub = fleetCenter ? getNearestPoint(fleetCenter, depositPlanets) : null;
  const hasCargo = ships.some((ship) => ship.classeVaisseau?.includes("CARGO"));
  const cargoTypes = constructibleTypes.filter((type) =>
    type.classeVaisseau?.includes("CARGO")
  );
  const shipSlotsUsed = getResourceQuantity(team, "VAISSEAU");
  const shipSlotCapacity = getResourceQuantity(team, "EMPLACEMENT_VAISSEAU");
  const visiblePlanets = cells.filter(
    (cell) => cell.planete && !cell.planete.estVide && cell.planete.mineraiDisponible > 0
  );
  const visibleTargets = visiblePlanets
    .map((cell) => {
      const nearestShip = getNearestPoint(
        { coord_x: cell.coord_x, coord_y: cell.coord_y },
        ships
      );
      const nearestDeposit = getNearestPoint(
        { coord_x: cell.coord_x, coord_y: cell.coord_y },
        depositPlanets
      );
      const ownerStatus =
        cell.proprietaire?.identifiant === TEAM_ID
          ? "owned"
          : cell.proprietaire?.identifiant
            ? "enemy"
            : "neutral";
      const target = {
        identifiant: cell.planete.identifiant,
        nom: cell.planete.nom,
        coord_x: cell.coord_x,
        coord_y: cell.coord_y,
        ownerStatus,
        mineraiDisponible: cell.planete.mineraiDisponible,
        slotsConstruction: cell.planete.slotsConstruction,
        pointDeVie: cell.planete.pointDeVie,
        nearestShipDistance: nearestShip?.distance ?? 999,
        nearestShipName: nearestShip?.point?.nom ?? null,
        nearestDepositDistance: nearestDeposit?.distance ?? 999
      };

      return {
        ...target,
        score: scoreEconomyTarget(
          {
            ...target,
            planete: {
              mineraiDisponible: target.mineraiDisponible,
              slotsConstruction: target.slotsConstruction
            }
          },
          {
            hasCargo
          }
        )
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const primaryTarget = visibleTargets[0] ?? null;
  const primaryMiner =
    primaryTarget && ships.length
      ? ships.find((ship) => ship.nom === primaryTarget.nearestShipName) ?? ships[0]
      : ships[0] ?? null;
  const fleetRoles = ships.map((ship) => ({
    identifiant: ship.identifiant,
    nom: ship.nom,
    role: getShipRole(ship, {
      hasCargo,
      primaryMiner
    }),
    coord_x: ship.coord_x,
    coord_y: ship.coord_y,
    mineraiTransporte: ship.mineraiTransporte,
    classeVaisseau: ship.classeVaisseau
  }));
  const recommendations = [];

  if (primaryTarget && primaryMiner) {
    recommendations.push({
      priority: "high",
      title: "Lancer la boucle de recolte courte",
      detail: `${primaryMiner.nom} doit viser ${primaryTarget.nom} (${primaryTarget.coord_x},${primaryTarget.coord_y}) pour amorcer la collecte.`,
      why: "C'est la cible miniere visible avec le meilleur rendement distance/ressource autour de la flotte."
    });
  }

  if (nearestHub?.point) {
    recommendations.push({
      priority: "high",
      title: "Utiliser un hub de depot fixe",
      detail: `${nearestHub.point.nom} (${nearestHub.point.coord_x},${nearestHub.point.coord_y}) est le meilleur point de retour visible pour deposer le minerai.`,
      why: "Cette planete possede deja un module DECHARGEMENT_RESSOURCE."
    });
  }

  if (!hasCargo && cargoTypes.length && shipyardPlanets.length) {
    const cargoLabel = cargoTypes[0].classeVaisseau ?? cargoTypes[0].nom ?? "cargo";
    recommendations.push({
      priority: "high",
      title: "Objectif de reconstruction",
      detail: `Des que la premiere boucle rapporte assez, construis un ${cargoLabel} sur ${shipyardPlanets[0].nom}.`,
      why: "Sans cargo, ta boucle eco reste lente et immobilise tes chasseurs."
    });
  }

  if (shipSlotCapacity > 0 && shipSlotsUsed >= shipSlotCapacity) {
    recommendations.push({
      priority: "medium",
      title: "Saturation de flotte",
      detail: "Tes emplacements vaisseaux sont pleins.",
      why: "Verifier rapidement si un depot, module ou regle peut augmenter la capacite avant de relancer la production."
    });
  } else if (shipSlotCapacity > 0) {
    recommendations.push({
      priority: "medium",
      title: "Capacite de production",
      detail: `${shipSlotsUsed}/${shipSlotCapacity} emplacements vaisseaux utilises.`,
      why: "Tu as encore de la marge pour transformer du minerai en nouveaux vaisseaux."
    });
  }

  if (primaryTarget?.ownerStatus === "neutral" && primaryTarget.slotsConstruction >= 4) {
    recommendations.push({
      priority: "medium",
      title: "Conquete apres premiere rotation",
      detail: `${primaryTarget.nom} cumule minerai et slots. Teste CONQUERIR apres avoir securise un premier depot.`,
      why: "Cela ouvre un two-step rentable: points de claim puis nouvelle base de production."
    });
  }

  return {
    summary: {
      points: getResourceQuantity(team, "POINT"),
      credits: getResourceQuantity(team, "CREDIT"),
      minerai: getResourceQuantity(team, "MINERAI"),
      shipSlotsUsed,
      shipSlotCapacity,
      hasCargo,
      canDeposit: depositPlanets.length > 0,
      canBuildShips: shipyardPlanets.length > 0,
      canBuildCargo: cargoTypes.length > 0
    },
    range,
    hubs: depositPlanets.map((planet) => ({
      identifiant: planet.identifiant,
      nom: planet.nom,
      coord_x: planet.coord_x,
      coord_y: planet.coord_y
    })),
    shipyards: shipyardPlanets.map((planet) => ({
      identifiant: planet.identifiant,
      nom: planet.nom,
      coord_x: planet.coord_x,
      coord_y: planet.coord_y,
      constructibleTypes: getAllConstructibleTypes([planet])
    })),
    fleetRoles,
    visibleTargets,
    recommendations
  };
}

function computeRangeFromShips(ships) {
  if (!ships.length) {
    return DEFAULT_RANGE;
  }

  const xs = ships.map((ship) => ship.coord_x);
  const ys = ships.map((ship) => ship.coord_y);

  return {
    x: clampRange([
      Math.min(...xs) - DEFAULT_PADDING,
      Math.max(...xs) + DEFAULT_PADDING
    ]),
    y: clampRange([
      Math.min(...ys) - DEFAULT_PADDING,
      Math.max(...ys) + DEFAULT_PADDING
    ])
  };
}

async function apiGet(pathname) {
  const response = await authorizedFetch(pathname);

  if (!response.ok) {
    const message = await response.text();
    const error = new Error(`API ${response.status} sur ${pathname}: ${message}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function apiProbe(pathname) {
  const response = await authorizedFetch(pathname, {
    retryUnauthorized: false
  });
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    payload
  };
}

async function fetchLeaderboard() {
  const candidatePaths = cachedLeaderboardPath
    ? [
        cachedLeaderboardPath,
        ...LEADERBOARD_CANDIDATE_PATHS.filter(
          (pathname) => pathname !== cachedLeaderboardPath
        )
      ]
    : [...LEADERBOARD_CANDIDATE_PATHS];
  const attempts = [];

  for (const pathname of candidatePaths) {
    const result = await apiProbe(pathname);

    attempts.push({
      path: pathname,
      status: result.status
    });

    if (!result.ok) {
      continue;
    }

    // Use the robust extraction function instead of manual mapping
    const leaderboard = extractLeaderboard(result.payload);

    if (leaderboard.length) {
      cachedLeaderboardPath = pathname;

      return {
        sourcePath: pathname,
        attempts,
        leaderboard
      };
    }
  }

  const tokenCheck = await apiProbe(`/equipes/${TEAM_ID}/vaisseaux`);

  if (tokenCheck.status === 401) {
    const error = new Error(
      "Token API expire ou invalide. Rafraichis le TOKEN dans .env."
    );
    error.status = 401;
    throw error;
  }

  const attemptsLabel = attempts
    .map((attempt) => `${attempt.path} (${attempt.status})`)
    .join(", ");

  const error = new Error(
    `Classement introuvable avec les routes testees: ${attemptsLabel}`
  );
  error.status = 404;
  throw error;
}

function ensureConfig(req, res, next) {
  const missing = missingConfig();

  if (missing.length) {
    res.status(500).json({
      error: "Configuration manquante",
      missing,
      searchedEnvFiles: ENV_PATHS
    });
    return;
  }

  next();
}

app.use(express.static(PUBLIC_DIR));

app.get("/api/health", async (req, res) => {
  const missing = missingConfig();
  const health = {
    ok: true,
    mapSize: MAP_SIZE,
    backend: {
      status: "running",
      port: PORT,
      envLoadedFrom: ENV_PATHS.find((envPath) => fs.existsSync(envPath)) ?? null,
      authMode: getAuthMode(),
      tokenExpiresAt:
        authState.accessTokenExpMs > 0
          ? new Date(authState.accessTokenExpMs).toISOString()
          : null
    },
    config: {
      complete: missing.length === 0,
      missing: missing
    },
    gameAPI: {
      url: API_URL,
      status: "unknown"
    }
  };

  // Try to reach game API
  if (!missing.length) {
    try {
      const testRes = await fetch(`${API_URL}/equipes/${TEAM_ID}/vaisseaux`, {
        headers: {
          Authorization: `Bearer ${authState.accessToken || ""}`,
          Accept: "application/json"
        }
      });
      
      if (testRes.ok) {
        health.gameAPI.status = "reachable";
      } else if (testRes.status === 401) {
        health.gameAPI.status = "unauthorized";
        health.gameAPI.errorCode = 401;
        health.gameAPI.hint = "Token invalid or expired. The backend will try to refresh it.";
      } else {
        health.gameAPI.status = "error";
        health.gameAPI.errorCode = testRes.status;
        const text = await testRes.text();
        health.gameAPI.errorMessage = text.substring(0, 200);
      }
    } catch (err) {
      health.gameAPI.status = "unreachable";
      health.gameAPI.error = err.message;
      health.gameAPI.hint = "Cannot connect to " + API_URL + ". Check network connectivity or if the game API server is running.";
    }
  }

  res.json(health);
});

app.get("/api/ships", ensureConfig, async (req, res, next) => {
  try {
    const teamPayload = await apiGet(`/equipes/${TEAM_ID}`);
    const payload = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    const ships = filterActiveShips(
      extractArray(payload)
      .map(normalizeShip)
      .filter(Boolean),
      teamPayload
    );

    res.json({
      teamId: TEAM_ID,
      ships
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/map", ensureConfig, async (req, res, next) => {
  try {
    const xRange = parseRange(req.query.x_range, DEFAULT_RANGE.x);
    const yRange = parseRange(req.query.y_range, DEFAULT_RANGE.y);

    let cells = [];
    const isLargeRequest = (xRange[1] - xRange[0] > 20) || (yRange[1] - yRange[0] > 20);
    
    if (isLargeRequest && cachedFullMap.length > 0) {
      cells = cachedFullMap;
    } else {
      const payload = await apiGet(
        `/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`
      );
      cells = extractArray(payload).map(normalizeCell).filter(Boolean);
    }

    res.json({
      range: { x: xRange, y: yRange },
      cells
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/state", ensureConfig, async (req, res, next) => {
  try {
    const teamPayload = await apiGet(`/equipes/${TEAM_ID}`);
    const team = normalizeTeam(teamPayload);
    const shipsPayload = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    const ships = filterActiveShips(
      extractArray(shipsPayload)
      .map(normalizeShip)
      .filter(Boolean),
      teamPayload
    );
    const suggestedRange = computeRangeFromShips(ships);
    const xRange = parseRange(req.query.x_range, suggestedRange.x);
    const yRange = parseRange(req.query.y_range, suggestedRange.y);
    const mapPayload = await apiGet(
      `/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`
    );
    const cells = extractArray(mapPayload)
      .map(normalizeCell)
      .filter(Boolean);
    const economyPlan = buildEconomyPlan(team, ships, cells, {
      x: xRange,
      y: yRange
    });

    res.json({
      fetchedAt: new Date().toISOString(),
      mapSize: MAP_SIZE,
      teamId: TEAM_ID,
      team,
      range: { x: xRange, y: yRange },
      ships,
      cells,
      economyPlan
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/strategy/economy", ensureConfig, async (req, res, next) => {
  try {
    const teamPayload = await apiGet(`/equipes/${TEAM_ID}`);
    const team = normalizeTeam(teamPayload);
    const ships = filterActiveShips(
      extractArray(await apiGet(`/equipes/${TEAM_ID}/vaisseaux`))
      .map(normalizeShip)
      .filter(Boolean),
      teamPayload
    );
    const suggestedRange = computeRangeFromShips(ships);
    const xRange = parseRange(req.query.x_range, suggestedRange.x);
    const yRange = parseRange(req.query.y_range, suggestedRange.y);
    const cells = extractArray(
      await apiGet(`/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`)
    )
      .map(normalizeCell)
      .filter(Boolean);

    res.json({
      fetchedAt: new Date().toISOString(),
      teamId: TEAM_ID,
      economyPlan: buildEconomyPlan(team, ships, cells, {
        x: xRange,
        y: yRange
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/leaderboard", ensureConfig, async (req, res, next) => {
  try {
    const result = await fetchLeaderboard();

    res.json({
      fetchedAt: new Date().toISOString(),
      sourcePath: result.sourcePath,
      leaderboard: result.leaderboard
    });
  } catch (error) {
    next(error);
  }
});

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  
  // Log the full error for debugging
  console.error(`[${new Date().toISOString()}] ${status} Error on ${req.method} ${req.path}:`, error.message);

  const responseBody = {
    error: error.message || "Erreur interne",
    status: status,
    path: req.path,
    timestamp: new Date().toISOString()
  };

  // Add helpful hints for common errors
  if (status === 502) {
    responseBody.hint = "Backend cannot reach the game API. Check if http://37.187.156.222:8080 is accessible";
  } else if (status === 401) {
    responseBody.hint = "Invalid API token. Update TOKEN in Backend/.env";
  } else if (status === 404) {
    responseBody.hint = "API endpoint not found";
  }

  res.status(status).json(responseBody);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
