const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

loadEnv();

const API_URL = process.env.API_URL;
const TEAM_ID = process.env.TEAM_ID;
const AUTH_URL = process.env.AUTH_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;
const KEYCLOAK_USERNAME = process.env.KEYCLOAK_USERNAME;
const KEYCLOAK_PASSWORD = process.env.KEYCLOAK_PASSWORD;

let accessToken = process.env.TOKEN?.trim();
const MAP_SIZE = 58;

function loadEnv() {
  const rootEnv = path.join(process.cwd(), ".env");
  const backendEnv = path.join(process.cwd(), "Backend", ".env");
  const options = { quiet: true };

  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, ...options });
    return;
  }

  if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv, ...options });
    return;
  }

  dotenv.config(options);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireConfig() {
  if (!API_URL) {
    fail("API_URL manquant dans .env");
  }

  if (!TEAM_ID) {
    fail("TEAM_ID manquant dans .env");
  }

  const hasStaticToken = Boolean(accessToken);
  const hasKeycloakConfig =
    Boolean(AUTH_URL) &&
    Boolean(KEYCLOAK_REALM) &&
    Boolean(KEYCLOAK_CLIENT_ID) &&
    Boolean(KEYCLOAK_USERNAME) &&
    Boolean(KEYCLOAK_PASSWORD);

  if (!hasStaticToken && !hasKeycloakConfig) {
    fail("TOKEN manquant dans .env, et configuration Keycloak incomplete.");
  }
}

async function apiGet(pathname) {
  const response = await fetch(`${API_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json"
    }
  });

  return handleResponse(response, { method: "GET", pathname });
}

async function apiPost(pathname, body) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return handleResponse(response, { method: "POST", pathname, body });
}

async function handleResponse(response, context) {
  const rawText = await response.text();
  const data = parseJson(rawText);

  if (response.status === 401 && canUseKeycloak()) {
    accessToken = null;

    const retryResponse = await fetch(`${API_URL}${context.pathname}`, {
      method: context.method,
      headers: {
        Authorization: `Bearer ${await getAccessToken(true)}`,
        Accept: "application/json",
        ...(context.body ? { "Content-Type": "application/json" } : {})
      },
      ...(context.body ? { body: JSON.stringify(context.body) } : {})
    });

    return handleFinalResponse(retryResponse);
  }

  return handleFinalResponse({
    ok: response.ok,
    status: response.status,
    text: async () => rawText
  });
}

async function handleFinalResponse(response) {
  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const message =
      data?.message || data?.error || rawText || `Erreur ${response.status}`;

    if (response.status === 401) {
      throw buildApiError(
        response.status,
        `401 Unauthorized: token invalide ou expire. ${message}`,
        data ?? rawText
      );
    }

    throw buildApiError(response.status, `${response.status} ${message}`, data ?? rawText);
  }

  return data ?? rawText;
}

function buildApiError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function canUseKeycloak() {
  return (
    Boolean(AUTH_URL) &&
    Boolean(KEYCLOAK_REALM) &&
    Boolean(KEYCLOAK_CLIENT_ID) &&
    Boolean(KEYCLOAK_USERNAME) &&
    Boolean(KEYCLOAK_PASSWORD)
  );
}

async function getAccessToken(forceRefresh = false) {
  if (accessToken && !forceRefresh) {
    return accessToken;
  }

  if (!canUseKeycloak()) {
    fail("TOKEN expire et configuration Keycloak incomplete.");
  }

  const tokenUrl = `${AUTH_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: KEYCLOAK_CLIENT_ID,
      username: KEYCLOAK_USERNAME,
      password: KEYCLOAK_PASSWORD
    }).toString()
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok || !data?.access_token) {
    const message =
      data?.error_description ||
      data?.error ||
      rawText ||
      `Erreur ${response.status}`;
    throw new Error(`Impossible de recuperer un token Keycloak. ${message}`);
  }

  accessToken = data.access_token.trim();
  return accessToken;
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractArray(payload) {
  return Array.isArray(payload) ? payload : [];
}

function pickCoord(payload, axis) {
  if (!payload) {
    return null;
  }

  const upper = axis.toUpperCase();
  const candidates = [
    payload[`coord_${axis}`],
    payload[`position${upper}`],
    payload[`coord${upper}`],
    payload[axis]
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeConstructibleType(type) {
  if (!type) {
    return null;
  }

  return {
    identifiant: type.id ?? type.identifiant ?? null,
    nom: type.nom ?? type.name ?? null,
    classeVaisseau: type.classeVaisseau ?? null,
    coutConstruction: Number(type.coutConstruction ?? 0)
  };
}

function normalizeModule(module) {
  if (!module) {
    return null;
  }

  const paramModule = module.paramModule ?? module;

  return {
    identifiant: module.id ?? module.identifiant ?? null,
    pointDeVie: Number(paramModule.pointDeVie ?? 0),
    attaque: Number(paramModule.attaque ?? 0),
    nombreSlotsOccupes: Number(paramModule.nombreSlotsOccupes ?? 0),
    typeModule: paramModule.typeModule ?? module.typeModule ?? null,
    listeVaisseauxConstructible: extractArray(
      paramModule.listeVaisseauxConstructible
    )
      .map(normalizeConstructibleType)
      .filter(Boolean)
  };
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

  return {
    identifiant: planet.identifiant ?? planet.id ?? null,
    nom: planet.nom ?? "Planete inconnue",
    coord_x: pickCoord(planet, "x"),
    coord_y: pickCoord(planet, "y"),
    mineraiDisponible: Number(planet.mineraiDisponible ?? 0),
    pointDeVie: Number(planet.pointDeVie ?? 0),
    slotsConstruction: Number(planet.slotsConstruction ?? 0),
    typePlanete,
    estVide: typePlanete === "VIDE",
    modules: extractArray(planet.modules).map(normalizeModule).filter(Boolean)
  };
}

function normalizeShip(ship) {
  const rawClass =
    ship.modeleVaisseau?.classeVaisseau ||
    ship.modele?.classeVaisseau ||
    ship.type;
  const classLabel =
    typeof rawClass === "string"
      ? rawClass
      : rawClass?.classeVaisseau || rawClass?.libelle || rawClass?.nom || null;

  return {
    id: ship.idVaisseau || ship.id,
    nom: ship.nom || ship.name || "Sans nom",
    classe: classLabel || "INCONNU",
    coord_x: ship.positionX ?? ship.coord_x ?? ship.x ?? 0,
    coord_y: ship.positionY ?? ship.coord_y ?? ship.y ?? 0,
    minerai: ship.mineraiTransporte ?? ship.minerai ?? 0,
    cooldown: ship.cooldown ?? 0
  };
}

async function getShips() {
  const ships = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
  return Array.isArray(ships) ? ships.map(normalizeShip) : [];
}

async function getTeam() {
  return apiGet(`/equipes/${TEAM_ID}`);
}

function normalizeTeam(team) {
  return {
    identifiant: team?.idEquipe ?? team?.identifiant ?? null,
    nom: team?.nom ?? "Equipe inconnue",
    ressources: extractArray(team?.ressources).map((resourceEntry) => {
      const resource = resourceEntry?.ressource ?? resourceEntry ?? {};
      const resourceType =
        resource.typeRessource ??
        resource.type?.typeRessource ??
        resource.type?.type ??
        resource.type ??
        resourceEntry?.typeRessource ??
        null;

      return {
        identifiant: resource.idRessource ?? resource.id ?? null,
        nom: resource.nom ?? null,
        type: resourceType,
        quantite: Number(resourceEntry?.quantite ?? resourceEntry?.valeur ?? 0)
      };
    }),
    planetes: extractArray(team?.planetes)
      .map(normalizePlanet)
      .filter(Boolean)
  };
}

async function getTeamState() {
  return normalizeTeam(await getTeam());
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

function clampCoord(value) {
  return Math.max(0, Math.min(MAP_SIZE - 1, Number(value)));
}

async function getMap(xMin = 0, xMax = MAP_SIZE - 1, yMin = 0, yMax = MAP_SIZE - 1) {
  const xRange = [clampCoord(xMin), clampCoord(xMax)].sort((left, right) => left - right);
  const yRange = [clampCoord(yMin), clampCoord(yMax)].sort((left, right) => left - right);
  const payload = await apiGet(
    `/monde/map?x_range=${xRange.join(",")}&y_range=${yRange.join(",")}`
  );

  return extractArray(payload).map(normalizeCell).filter(Boolean);
}

async function sendShipAction(shipId, action, x, y) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseaux/${shipId}/demander-action`, {
    action,
    coord_x: Number(x),
    coord_y: Number(y)
  });
}

function printUsage() {
  console.log("Usage:");
  console.log("npm.cmd run game -- ships");
  console.log("npm.cmd run game -- team");
  console.log('npm.cmd run game -- move "Chasseur leger 0" 6 40');
  console.log('npm.cmd run game -- harvest "Chasseur leger 0" 6 40');
  console.log('npm.cmd run game -- deposit "Chasseur leger 0" 5 44');
  console.log('npm.cmd run game -- conquer "Chasseur leger 0" 6 40');
}

function printShips(ships) {
  if (ships.length === 0) {
    console.log("Aucun vaisseau trouve.");
    return;
  }

  for (const ship of ships) {
    console.log(
      `- ${ship.nom} | ${ship.classe} | (${ship.coord_x}, ${ship.coord_y}) | minerai ${ship.minerai} | cooldown ${ship.cooldown} | id ${ship.id}`
    );
  }
}

function printTeam(team) {
  const nom = team.nom || "Equipe";
  const ressources = Array.isArray(team.ressources) ? team.ressources : [];

  console.log(nom);

  for (const resource of ressources) {
    const rawType = resource.typeRessource || resource.type;
    const type =
      typeof rawType === "string"
        ? rawType
        : rawType?.typeRessource || rawType?.libelle || rawType?.nom || "INCONNU";
    const value = resource.quantite ?? resource.valeur ?? 0;
    console.log(`- ${type}: ${value}`);
  }
}

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function findShipByName(name) {
  const ships = await getShips();
  const normalizedName = normalizeText(name);
  const ship = ships.find((item) => normalizeText(item.nom) === normalizedName);

  if (!ship) {
    throw new Error(`Vaisseau introuvable: ${name}`);
  }

  return ship;
}

function mapCommandToAction(command) {
  if (command === "move") {
    return "DEPLACEMENT";
  }

  if (command === "harvest") {
    return "RECOLTER";
  }

  if (command === "deposit") {
    return "DEPOSER";
  }

  if (command === "conquer") {
    return "CONQUERIR";
  }

  if (command === "attack") {
    return "ATTAQUER";
  }

  if (command === "repair") {
    return "REPARER";
  }

  return null;
}

async function run() {
  requireConfig();

  const [command, shipName, x, y] = process.argv.slice(2);

  if (!command) {
    printUsage();
    return;
  }

  if (command === "ships") {
    printShips(await getShips());
    return;
  }

  if (command === "team") {
    printTeam(await getTeam());
    return;
  }

  const action = mapCommandToAction(command);

  if (!action) {
    printUsage();
    fail(`Commande inconnue: ${command}`);
  }

  if (!shipName || x === undefined || y === undefined) {
    printUsage();
    fail("Il faut fournir un vaisseau, x et y.");
  }

  const ship = await findShipByName(shipName);

  console.log(
    `Envoi de ${action} pour ${ship.nom} vers (${Number(x)}, ${Number(y)})`
  );

  const result = await sendShipAction(ship.id, action, x, y);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  findShipByName,
  getMap,
  getShips,
  getTeam,
  getTeamState,
  normalizeText,
  requireConfig,
  sendShipAction
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
