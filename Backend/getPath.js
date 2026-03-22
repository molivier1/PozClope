import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: false });

const API_URL = process.env.API_URL;
const AUTH_BASE_URL = process.env.KEYCLOAK_URL ?? process.env.AUTH_URL ?? null;
const AUTH_REALM = process.env.KEYCLOAK_REALM ?? "24hcode";
const AUTH_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "vaissals-backend";
const AUTH_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? null;
const AUTH_USERNAME = process.env.KEYCLOAK_USERNAME ?? null;
const AUTH_PASSWORD = process.env.KEYCLOAK_PASSWORD ?? null;

const authState = {
  accessToken: process.env.TOKEN?.trim() ?? null,
  accessTokenExpMs: 0,
  refreshToken: null
};

function decodeJwtPayload(token) {
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }

    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function getTokenExpiryMs(token) {
  const payload = decodeJwtPayload(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : 0;
}

function isTokenUsable(expiresAtMs) {
  return Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 60000;
}

async function requestToken(formData) {
  if (!AUTH_BASE_URL) {
    throw new Error("AUTH_URL manquant dans .env");
  }

  const tokenUrl = `${AUTH_BASE_URL}/realms/${AUTH_REALM}/protocol/openid-connect/token`;
  const payload = new URLSearchParams({
    client_id: AUTH_CLIENT_ID,
    ...formData
  });

  if (AUTH_CLIENT_SECRET) {
    payload.set("client_secret", AUTH_CLIENT_SECRET);
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload
  });

  if (!res.ok) {
    throw new Error(`Erreur Auth ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  authState.accessToken = json.access_token;
  authState.accessTokenExpMs = getTokenExpiryMs(json.access_token);
  if (json.refresh_token) {
    authState.refreshToken = json.refresh_token;
  }

  return authState.accessToken;
}

async function ensureAccessToken(forceRefresh = false) {
  if (!forceRefresh && isTokenUsable(authState.accessTokenExpMs)) {
    return authState.accessToken;
  }

  if (authState.refreshToken) {
    try {
      return await requestToken({
        grant_type: "refresh_token",
        refresh_token: authState.refreshToken
      });
    } catch {
      authState.refreshToken = null;
    }
  }

  if (AUTH_USERNAME && AUTH_PASSWORD) {
    return requestToken({
      grant_type: "password",
      username: AUTH_USERNAME,
      password: AUTH_PASSWORD
    });
  }

  if (authState.accessToken) {
    return authState.accessToken;
  }

  throw new Error("Impossible d'obtenir un token valide.");
}

authState.accessTokenExpMs = getTokenExpiryMs(authState.accessToken);

export async function get(resourcePath) {
  if (!API_URL) {
    throw new Error("API_URL manquant dans .env");
  }

  let token = await ensureAccessToken();
  let res = await fetch(`${API_URL}${resourcePath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (res.status === 401) {
    token = await ensureAccessToken(true);
    res = await fetch(`${API_URL}${resourcePath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur ${res.status} : ${text}`);
  }

  return res.json();
}
