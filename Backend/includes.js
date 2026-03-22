const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

// Chargement robuste de la configuration (comme dans server.js)
const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATHS = [
  path.join(ROOT_DIR, ".env"),
  path.join(__dirname, ".env")
];

for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
    break;
  }
}

const API_URL = process.env.API_URL;
const STATIC_TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;

// Configuration Authentification
const AUTH_BASE_URL = process.env.KEYCLOAK_URL ?? process.env.AUTH_URL ?? null;
const AUTH_REALM = process.env.KEYCLOAK_REALM ?? "24hcode";
const AUTH_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "vaissals-backend";
const AUTH_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? null;
const AUTH_USERNAME = process.env.KEYCLOAK_USERNAME ?? null;
const AUTH_PASSWORD = process.env.KEYCLOAK_PASSWORD ?? null;

const authState = {
  accessToken: STATIC_TOKEN ?? null,
  accessTokenExpMs: 0,
  refreshToken: null
};

// --- Fonctions d'authentification (Portées depuis server.js) ---

function decodeJwtPayload(token) {
  if (!token) return null;
  try {
    const parts = token.split(".");
    return parts.length < 2 ? null : JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { return null; }
}

function getTokenExpiryMs(token) {
  const payload = decodeJwtPayload(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : 0;
}

authState.accessTokenExpMs = getTokenExpiryMs(STATIC_TOKEN);

function isTokenUsable(expiresAtMs) {
  return Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 60000; // Marge de 60s
}

async function requestToken(formData) {
  if (!AUTH_BASE_URL) throw new Error("URL d'authentification manquante (KEYCLOAK_URL/AUTH_URL)");

  const tokenUrl = `${AUTH_BASE_URL}/realms/${AUTH_REALM}/protocol/openid-connect/token`;
  const payload = new URLSearchParams({ client_id: AUTH_CLIENT_ID, ...formData });
  if (AUTH_CLIENT_SECRET) payload.set("client_secret", AUTH_CLIENT_SECRET);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload
  });

  if (!res.ok) throw new Error(`Erreur Auth ${res.status}: ${await res.text()}`);

  const json = await res.json();
  authState.accessToken = json.access_token;
  authState.accessTokenExpMs = getTokenExpiryMs(json.access_token);
  if (json.refresh_token) authState.refreshToken = json.refresh_token;

  return authState.accessToken;
}

async function ensureAccessToken(forceRefresh = false) {
  // 1. Si token valide et pas de refresh forcé, on l'utilise
  if (!forceRefresh && isTokenUsable(authState.accessTokenExpMs)) {
    return authState.accessToken;
  }

  // 2. Si on a un refresh token, on l'utilise
  if (authState.refreshToken) {
    try {
      return await requestToken({ grant_type: "refresh_token", refresh_token: authState.refreshToken });
    } catch (e) {
      console.warn("Refresh token invalide, repli sur mot de passe...");
      authState.refreshToken = null;
    }
  }

  // 3. Sinon, on utilise le mot de passe (si configuré)
  if (AUTH_USERNAME && AUTH_PASSWORD) {
    console.log("🔑 Authentification par mot de passe...");
    return await requestToken({ grant_type: "password", username: AUTH_USERNAME, password: AUTH_PASSWORD });
  }

  throw new Error("Impossible d'obtenir un token : Credentials manquants ou token expiré.");
}

async function authorizedFetch(path, options = {}) {
  const { retryUnauthorized = true, ...fetchOptions } = options;
  let token = await ensureAccessToken();

  const headers = {
    ...fetchOptions.headers,
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };

  let res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });

  // Retry on 401
  if (res.status === 401 && retryUnauthorized && (AUTH_PASSWORD || authState.refreshToken)) {
    console.log("⚠️ Token expiré (401), tentative de reconnexion...");
    token = await ensureAccessToken(true);
    headers.Authorization = `Bearer ${token}`;
    res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers });
  }

  return res;
}

// --- Fonctions API ---

async function apiGet(path) {
  const res = await authorizedFetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur ${res.status} : ${text}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await authorizedFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur ${res.status} : ${text}`);
  }

  // Gestion des réponses vides (ex: 204 No Content ou 200 OK vide)
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

module.exports = {
  API_URL,
  TEAM_ID,
  ensureAccessToken,
  authorizedFetch,
  apiGet,
  apiPost
};
