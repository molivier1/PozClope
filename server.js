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

const app = express();
let cachedLeaderboardPath = null;
const authState = {
  accessToken: STATIC_TOKEN ?? null,
  accessTokenExpMs: getTokenExpiryMs(STATIC_TOKEN),
  refreshToken: null,
  refreshTokenExpMs: 0
};

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

  const typePlanete = planet.modelePlanete?.typePlanete ?? null;

  return {
    identifiant: planet.identifiant ?? planet.id ?? null,
    nom: planet.nom ?? "Planete inconnue",
    description: planet.description ?? "",
    coord_x: pickCoord(planet, "x"),
    coord_y: pickCoord(planet, "y"),
    mineraiDisponible: Number(planet.mineraiDisponible ?? 0),
    pointDeVie: Number(planet.pointDeVie ?? 0),
    slotsConstruction: Number(planet.slotsConstruction ?? 0),
    biome: planet.modelePlanete?.biome ?? null,
    typePlanete,
    estVide: typePlanete === "VIDE",
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
    planete: normalizePlanet(cell.planete)
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
    type: ship.modeleVaisseau?.nom ?? ship.type?.nom ?? ship.type ?? null,
    coord_x: x,
    coord_y: y,
    pointDeVie: Number(ship.pointDeVie ?? 0),
    vitesse: Number(ship.vitesse ?? 0),
    mineraiTransporte: Number(ship.mineraiTransporte ?? 0)
  };
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

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });
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

async function ensureAccessToken(options = {}) {
  const { forceRefresh = false } = options;

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

  if (authState.accessToken && !forceRefresh && isTokenUsable(authState.accessTokenExpMs, 0)) {
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

async function authorizedFetch(pathname, options = {}) {
  const { retryUnauthorized = true } = options;
  const accessToken = await ensureAccessToken();
  let response = await fetch(`${API_URL}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401 && retryUnauthorized && canRefreshAuth()) {
    authState.accessToken = null;
    authState.accessTokenExpMs = 0;

    const refreshedToken = await ensureAccessToken({ forceRefresh: true });

    response = await fetch(`${API_URL}${pathname}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${refreshedToken}`
      }
    });
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

  const score = Number(
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

    const leaderboard = result.payload
      .filter(entry => entry.idEquipe)
      .map(entry => ({
        nom: entry.nom,
        score: getScore(entry)
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({
        rang: index + 1,
        ...entry
      }));

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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mapSize: MAP_SIZE,
    envLoadedFrom: ENV_PATHS.find((envPath) => fs.existsSync(envPath)) ?? null,
    authMode: getAuthMode(),
    tokenExpiresAt:
      authState.accessTokenExpMs > 0
        ? new Date(authState.accessTokenExpMs).toISOString()
        : null
  });
});

app.get("/api/ships", ensureConfig, async (req, res, next) => {
  try {
    const payload = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    const ships = extractArray(payload)
      .map(normalizeShip)
      .filter(Boolean);

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
    const payload = await apiGet(
      `/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`
    );
    const cells = extractArray(payload)
      .map(normalizeCell)
      .filter(Boolean);

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
    const shipsPayload = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    const ships = extractArray(shipsPayload)
      .map(normalizeShip)
      .filter(Boolean);
    const suggestedRange = computeRangeFromShips(ships);
    const xRange = parseRange(req.query.x_range, suggestedRange.x);
    const yRange = parseRange(req.query.y_range, suggestedRange.y);
    const mapPayload = await apiGet(
      `/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`
    );
    const cells = extractArray(mapPayload)
      .map(normalizeCell)
      .filter(Boolean);

    res.json({
      fetchedAt: new Date().toISOString(),
      mapSize: MAP_SIZE,
      teamId: TEAM_ID,
      range: { x: xRange, y: yRange },
      ships,
      cells
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

  res.status(status).json({
    error: error.message || "Erreur interne"
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
