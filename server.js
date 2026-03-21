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

for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const PORT = Number(process.env.PORT || 3000);
const API_URL = process.env.API_URL;
const TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;

const app = express();

function missingConfig() {
  const missing = [];

  if (!API_URL) {
    missing.push("API_URL");
  }
  if (!TOKEN) {
    missing.push("TOKEN");
  }
  if (!TEAM_ID) {
    missing.push("TEAM_ID");
  }

  return missing;
}

function extractArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
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
  const response = await fetch(`${API_URL}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${TOKEN}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`API ${response.status} sur ${pathname}: ${message}`);
  }

  return response.json();
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
    envLoadedFrom: ENV_PATHS.find((envPath) => fs.existsSync(envPath)) ?? null
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

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  res.status(500).json({
    error: error.message || "Erreur interne"
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
