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

async function apiPut(pathname, body) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return handleResponse(response, { method: "PUT", pathname, body });
}

async function apiPatch(pathname, body) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return handleResponse(response, { method: "PATCH", pathname, body });
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
  const rawType =
    ship.modeleVaisseau ??
    ship.type ??
    ship.modele ??
    null;
  const rawClass =
    rawType?.classeVaisseau ??
    ship.classeVaisseau ??
    ship.type;
  const classLabel =
    typeof rawClass === "string"
      ? rawClass
      : rawClass?.classeVaisseau || rawClass?.libelle || rawClass?.nom || null;

  return {
    id: ship.idVaisseau || ship.id,
    nom: ship.nom || ship.name || "Sans nom",
    classe: classLabel || "INCONNU",
    classeVaisseau: classLabel || null,
    typeId: rawType?.id ?? null,
    typeNom:
      rawType?.nom ??
      (typeof rawType === "string" ? rawType : null),
    coord_x: ship.positionX ?? ship.coord_x ?? ship.x ?? 0,
    coord_y: ship.positionY ?? ship.coord_y ?? ship.y ?? 0,
    minerai: ship.mineraiTransporte ?? ship.minerai ?? 0,
    cooldown: ship.cooldown ?? ship.dateProchaineAction ?? 0
  };
}

async function getShips() {
  const [teamPayload, shipsPayload] = await Promise.all([
    getTeam(),
    apiGet(`/equipes/${TEAM_ID}/vaisseaux`)
  ]);
  const ships = Array.isArray(shipsPayload) ? shipsPayload.map(normalizeShip) : [];
  return filterActiveShips(ships, teamPayload);
}

async function getTeam() {
  return apiGet(`/equipes/${TEAM_ID}`);
}

async function getTeamById(teamId) {
  return normalizeTeam(await apiGet(`/equipes/${teamId}`));
}

async function getTeams() {
  return extractArray(await apiGet("/equipes")).map(normalizeTeam);
}

async function getTeamsDetailed() {
  const teams = await getTeams();
  const teamIds = teams.map((team) => team.identifiant).filter(Boolean);
  return Promise.all(teamIds.map((teamId) => getTeamById(teamId)));
}

async function getPlans() {
  return apiGet(`/equipes/${TEAM_ID}/plans`);
}

async function getMarketOffers() {
  return apiGet("/market/offres");
}

async function getModules() {
  return apiGet(`/equipes/${TEAM_ID}/modules`);
}

async function buyOffer(offerId) {
  return apiGet(`/market/offres/${offerId}`);
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

function getConstructibleShipTypes(team) {
  const types = [];

  for (const planet of team.planetes || []) {
    for (const module of planet.modules || []) {
      for (const type of module.listeVaisseauxConstructible || []) {
        types.push({
          identifiant: type.identifiant,
          nom: type.nom,
          classeVaisseau: type.classeVaisseau,
          coutConstruction: type.coutConstruction,
          planeteIdentifiant: planet.identifiant,
          planeteNom: planet.nom
        });
      }
    }
  }

  return types;
}

function extractMarketShipTypes(offers) {
  const byClass = new Map();

  for (const offer of extractArray(offers)) {
    const plan =
      offer.planVaisseau ?? offer.plan ?? offer.objet?.planVaisseau ?? offer.objet?.plan;
    const type = plan?.typeVaisseau ?? null;

    if (!type?.classeVaisseau || !type?.id) {
      continue;
    }

    const current = byClass.get(type.classeVaisseau);

    if (!current || Number(type.coutConstruction ?? 0) < Number(current.coutConstruction ?? 0)) {
      byClass.set(type.classeVaisseau, {
        identifiant: type.id,
        nom: type.nom ?? null,
        classeVaisseau: type.classeVaisseau,
        coutConstruction: Number(type.coutConstruction ?? 0),
        capaciteTransport: Number(type.capaciteTransport ?? 0)
      });
    }
  }

  return byClass;
}

async function buildShip(name, typeId, planetId) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseau/construire`, {
    nom: name,
    idTypeVaisseau: typeId,
    idPlanete: planetId
  });
}

async function placeModule(moduleId, planetId) {
  return apiPut(`/equipes/${TEAM_ID}/module/${moduleId}/poser`, {
    idModule: moduleId,
    idPlanete: planetId
  });
}

async function renameShip(shipId, shipName) {
  const candidates = [
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { nom: shipName }
    },
    {
      method: "POST",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseau/${shipId}`,
      body: { nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseau/${shipId}`,
      body: { nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "POST",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseau/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "POST",
      pathname: `/equipes/${TEAM_ID}/vaisseau/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseau/${shipId}/renommer`,
      body: { nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { idVaisseau: shipId, nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { idVaisseau: shipId, nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/nom`,
      body: { nom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/nom`,
      body: { nom: shipName }
    },
    {
      method: "POST",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}/nom`,
      body: { nom: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { name: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { name: shipName }
    },
    {
      method: "PUT",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { nouveauNom: shipName }
    },
    {
      method: "PATCH",
      pathname: `/equipes/${TEAM_ID}/vaisseaux/${shipId}`,
      body: { nouveauNom: shipName }
    }
  ];
  const errors = [];

  for (const candidate of candidates) {
    try {
      if (candidate.method === "PUT") {
        return await apiPut(candidate.pathname, candidate.body);
      }

      if (candidate.method === "PATCH") {
        return await apiPatch(candidate.pathname, candidate.body);
      }

      return await apiPost(candidate.pathname, candidate.body);
    } catch (error) {
      errors.push(`${candidate.method} ${candidate.pathname} -> ${error.message}`);
    }
  }

  throw new Error(
    `Aucun endpoint de renommage compatible trouve.\n${errors.join("\n")}`
  );
}

function findCheapestModuleOffer(offers, typeModule) {
  return extractArray(offers)
    .map((offer) => ({
      offerId: offer.idOffre ?? offer.id ?? null,
      prix: Number(offer.prix ?? 0),
      module: offer.module ?? offer.objet?.module ?? null
    }))
    .filter((entry) => entry.offerId && entry.module?.paramModule?.typeModule === typeModule)
    .sort((left, right) => left.prix - right.prix)[0] ?? null;
}

function findCheapestPlanOffer(offers, shipClass) {
  return extractArray(offers)
    .map((offer) => ({
      offerId: offer.idOffre ?? offer.id ?? null,
      prix: Number(offer.prix ?? 0),
      plan:
        offer.planVaisseau ??
        offer.plan ??
        offer.objet?.planVaisseau ??
        offer.objet?.plan ??
        null
    }))
    .filter((entry) => entry.offerId && entry.plan?.typeVaisseau?.classeVaisseau === shipClass)
    .sort((left, right) => left.prix - right.prix)[0] ?? null;
}

function findOwnedModuleByType(modules, typeModule) {
  return extractArray(modules).find((module) => {
    const normalizedType = module?.paramModule?.typeModule ?? module?.typeModule ?? null;
    return normalizedType === typeModule;
  }) ?? null;
}

function findOwnedPlanByClass(plans, shipClass) {
  return extractArray(plans).find((plan) => {
    const normalizedClass = plan?.typeVaisseau?.classeVaisseau ?? null;
    return normalizedClass === shipClass;
  }) ?? null;
}

function extractOwnedPlansByClass(payload) {
  const plans = [];
  const seenKeys = new Set();

  const visit = (value) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const planType =
      value.typeVaisseau ??
      value.planVaisseau?.typeVaisseau ??
      value.planVaisseau ??
      null;
    const normalizedClass = String(
      planType?.classeVaisseau ?? value.classeVaisseau ?? ""
    ).trim();
    const planId = value.id ?? value.identifiant ?? null;
    const typeId = planType?.id ?? planType?.identifiant ?? null;

    if (normalizedClass) {
      const key = `${normalizedClass}:${typeId ?? ""}:${planId ?? ""}`;

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        plans.push({
          shipClass: normalizedClass,
          planId: planId ? String(planId) : null,
          typeId: typeId ? String(typeId) : null,
          typeName: planType?.nom ?? value.nom ?? normalizedClass
        });
      }
    }

    Object.values(value).forEach(visit);
  };

  visit(payload);
  return plans;
}

function buildShipCandidates(constructibleType, plans, marketOffers, shipClass) {
  const candidates = [];
  const seenIds = new Set();
  const pushCandidate = (typeId, source) => {
    const normalizedTypeId = String(typeId ?? "").trim();

    if (!normalizedTypeId || seenIds.has(normalizedTypeId)) {
      return;
    }

    seenIds.add(normalizedTypeId);
    candidates.push({
      typeId: normalizedTypeId,
      source
    });
  };

  for (const plan of extractOwnedPlansByClass(plans)) {
    if (plan.shipClass !== shipClass) {
      continue;
    }

    pushCandidate(plan.typeId, "plan.type");
    pushCandidate(plan.planId, "plan");
  }

  pushCandidate(constructibleType?.identifiant, "constructible");

  const marketType = extractMarketShipTypes(marketOffers).get(shipClass);
  pushCandidate(marketType?.identifiant, "market");

  return candidates;
}

async function tryBuildShip(name, constructibleType, plans, marketOffers, shipClass) {
  const attempts = [];
  const candidates = buildShipCandidates(
    constructibleType,
    plans,
    marketOffers,
    shipClass
  );

  if (candidates.length === 0) {
    throw new Error(
      `Impossible de resoudre le type de construction pour ${shipClass}, alors qu'il est annonce constructible sur ${constructibleType.planeteNom}.`
    );
  }

  for (const candidate of candidates) {
    try {
      const result = await buildShip(
        name,
        candidate.typeId,
        constructibleType.planeteIdentifiant
      );

      return {
        result,
        source: candidate.source,
        typeId: candidate.typeId,
        attempts
      };
    } catch (error) {
      attempts.push({
        source: candidate.source,
        typeId: candidate.typeId,
        message: error.message
      });
    }
  }

  const attemptSummary = attempts
    .map((attempt) => `${attempt.source}:${attempt.typeId} -> ${attempt.message}`)
    .join(" | ");
  throw new Error(
    `Impossible de construire ${shipClass} sur ${constructibleType.planeteNom}. ${attemptSummary || "Aucun id valide."}`
  );
}

function findBuildPlanet(team, acceptedModules) {
  for (const planet of team.planetes || []) {
    const hasShipyard = (planet.modules || []).some((module) =>
      acceptedModules.includes(module.typeModule)
    );

    if (hasShipyard) {
      return planet;
    }
  }

  return null;
}

function findConstructibleType(team, shipClass) {
  return getConstructibleShipTypes(team).find(
    (type) => type.classeVaisseau === shipClass
  ) ?? null;
}

function findPlanetByName(team, planetName) {
  if (!planetName) {
    return null;
  }

  const normalized = normalizeText(planetName);

  return (
    (team.planetes || []).find((planet) => normalizeText(planet.nom) === normalized) ?? null
  );
}

function findModulePlacementPlanet(team, slotsNeeded, preferredPlanetName = null) {
  const preferredPlanet = findPlanetByName(team, preferredPlanetName);

  if (preferredPlanet && Number(preferredPlanet.slotsConstruction ?? 0) >= slotsNeeded) {
    return preferredPlanet;
  }

  return [...(team.planetes || [])]
    .filter((planet) => Number(planet.slotsConstruction ?? 0) >= slotsNeeded)
    .sort((left, right) => Number(right.slotsConstruction ?? 0) - Number(left.slotsConstruction ?? 0))[0] ?? null;
}

function printUsage() {
  console.log("Usage:");
  console.log("npm.cmd run game -- ships");
  console.log("npm.cmd run game -- team");
  console.log("npm.cmd run game -- credits");
  console.log("npm.cmd run game -- planet-counts");
  console.log("npm.cmd run game -- cell 5 40");
  console.log("npm.cmd run game -- build-options");
  console.log('npm.cmd run game -- buy-offer "uuid-offre"');
  console.log('npm.cmd run game -- buy-plan CHASSEUR_MOYEN');
  console.log('npm.cmd run game -- build-ship CHASSEUR_MOYEN "Chasseur M 1"');
  console.log('npm.cmd run game -- buy-cargo-plan');
  console.log('npm.cmd run game -- buy-fighter-plan');
  console.log('npm.cmd run game -- buy-advanced-yard');
  console.log('npm.cmd run game -- place-advanced-yard "Nom Planete"');
  console.log('npm.cmd run game -- buy-cargo-medium-plan');
  console.log('npm.cmd run game -- build-cargo "Cargo 1"');
  console.log('npm.cmd run game -- build-fighter "Chasseur 2"');
  console.log('npm.cmd run game -- build-cargo-medium "Cargo M 1"');
  console.log('npm.cmd run game -- rename-ship "Ancien Nom" "Nouveau Nom"');
  console.log('npm.cmd run game -- move "Chasseur leger 0" 6 40');
  console.log('npm.cmd run game -- harvest "Chasseur leger 0" 6 40');
  console.log('npm.cmd run game -- deposit "Chasseur leger 0" 5 44');
  console.log('npm.cmd run game -- conquer "Chasseur leger 0" 6 40');
}

function printCell(cell) {
  if (!cell) {
    console.log("Case introuvable.");
    return;
  }

  console.log(`Case (${cell.coord_x}, ${cell.coord_y})`);

  if (!cell.planete) {
    console.log("- Aucune planete");
    return;
  }

  console.log(`- Planete: ${cell.planete.nom}`);
  console.log(`- Proprietaire: ${cell.proprietaire?.nom ?? "aucun"}`);
  console.log(`- PV: ${cell.planete.pointDeVie}`);
  console.log(`- Minerai: ${cell.planete.mineraiDisponible}`);
  console.log(`- Slots: ${cell.planete.slotsConstruction}`);
  console.log(`- Type: ${cell.planete.typePlanete ?? "INCONNU"}`);
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

function printBuildOptions(team) {
  const types = getConstructibleShipTypes(team);

  if (types.length === 0) {
    console.log("Aucun type de vaisseau constructible trouve.");
    return;
  }

  for (const type of types) {
    console.log(
      `- ${type.classeVaisseau} | planete ${type.planeteNom} | typeId ${type.identifiant}`
    );
  }
}

function getResourceQuantity(team, resourceName) {
  const normalizedName = String(resourceName).toUpperCase();

  const resource = (team.ressources || []).find((entry) => {
    const resourceType = String(entry.type ?? "").toUpperCase();
    const resourceLabel = String(entry.nom ?? "").toUpperCase();
    return resourceType === normalizedName || resourceLabel === normalizedName;
  });

  return Number(resource?.quantite ?? 0);
}

function printTeamCredits(teams) {
  const rows = teams
    .filter((team) => team.identifiant && team.identifiant !== TEAM_ID)
    .map((team) => ({
      nom: team.nom,
      credits: getResourceQuantity(team, "CREDIT"),
      points: getResourceQuantity(team, "POINT")
    }))
    .sort((left, right) => {
      if (right.credits !== left.credits) {
        return right.credits - left.credits;
      }

      if (right.points !== left.points) {
        return right.points - left.points;
      }

      return left.nom.localeCompare(right.nom, "fr");
    });

  if (rows.length === 0) {
    console.log("Aucune autre equipe trouvee.");
    return;
  }

  for (const row of rows) {
    console.log(`- ${row.nom} | CREDIT ${row.credits} | POINT ${row.points}`);
  }
}

function printTeamPlanetCounts(teams) {
  const rows = teams
    .filter((team) => team.identifiant && team.identifiant !== TEAM_ID)
    .map((team) => ({
      nom: team.nom,
      planetes: Array.isArray(team.planetes) ? team.planetes.length : 0,
      points: getResourceQuantity(team, "POINT")
    }))
    .sort((left, right) => {
      if (right.planetes !== left.planetes) {
        return right.planetes - left.planetes;
      }

      if (right.points !== left.points) {
        return right.points - left.points;
      }

      return left.nom.localeCompare(right.nom, "fr");
    });

  if (rows.length === 0) {
    console.log("Aucune autre equipe trouvee.");
    return;
  }

  for (const row of rows) {
    console.log(`- ${row.nom} | PLANETES ${row.planetes} | POINT ${row.points}`);
  }
}

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getRawShipId(ship) {
  const value =
    ship?.identifiant ??
    ship?.idVaisseau ??
    ship?.id ??
    null;

  return value === null || value === undefined ? null : String(value);
}

function normalizeCooldownValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function isOriginGhostShip(ship) {
  return Number(ship?.coord_x ?? ship?.x ?? 0) === 0 && Number(ship?.coord_y ?? ship?.y ?? 0) === 0;
}

function getActiveShipData(teamPayload) {
  const ids = new Set();
  const names = new Map();

  for (const ship of extractArray(teamPayload?.vaisseaux)) {
    const id = getRawShipId(ship);
    const name = ship?.nom;

    if (id) {
      ids.add(id);
    }

    if (name) {
      const key = normalizeText(name);
      const entries = names.get(key) ?? [];
      entries.push({
        cooldown: normalizeCooldownValue(ship?.dateProchaineAction ?? ship?.cooldown),
        minerai: Number(ship?.mineraiTransporte ?? ship?.minerai ?? 0),
        pointDeVie: Number(ship?.pointDeVie ?? 0)
      });
      names.set(key, entries);
    }
  }

  return { ids, names };
}

function scoreShipCandidate(ship, referenceEntries) {
  const cooldown = normalizeCooldownValue(ship?.cooldown ?? ship?.dateProchaineAction);
  const minerai = Number(ship?.minerai ?? ship?.mineraiTransporte ?? 0);
  const pointDeVie = Number(ship?.pointDeVie ?? 0);

  let score = 0;

  if (!isOriginGhostShip(ship)) {
    score += 1000;
  }

  if (referenceEntries.some((entry) => entry.cooldown && entry.cooldown === cooldown)) {
    score += 100;
  }

  if (referenceEntries.some((entry) => entry.minerai === minerai)) {
    score += 10;
  }

  if (pointDeVie > 0 && referenceEntries.some((entry) => entry.pointDeVie === pointDeVie)) {
    score += 5;
  }

  return score;
}

function filterActiveShips(ships, teamPayload) {
  const { ids: activeIds, names: activeNames } = getActiveShipData(teamPayload);

  if (activeIds.size === 0 && activeNames.size === 0) {
    return ships;
  }

  const byName = new Map();

  for (const ship of ships) {
    const shipId = getRawShipId(ship);
    const shipNameKey = normalizeText(ship.nom);

    if (shipId && activeIds.size > 0) {
      if (activeIds.has(shipId)) {
        const bucket = byName.get(shipNameKey) ?? [];
        bucket.push(ship);
        byName.set(shipNameKey, bucket);
        continue;
      }
    }

    if (activeNames.has(shipNameKey)) {
      const bucket = byName.get(shipNameKey) ?? [];
      bucket.push(ship);
      byName.set(shipNameKey, bucket);
    }
  }

  const filtered = [];

  for (const [nameKey, referenceEntries] of activeNames.entries()) {
    const candidates = byName.get(nameKey) ?? [];

    candidates.sort((left, right) => {
      const scoreGap = scoreShipCandidate(right, referenceEntries) - scoreShipCandidate(left, referenceEntries);

      if (scoreGap !== 0) {
        return scoreGap;
      }

      return normalizeCooldownValue(right.cooldown).localeCompare(normalizeCooldownValue(left.cooldown));
    });

    filtered.push(...candidates.slice(0, referenceEntries.length));
  }

  return filtered;
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

  if (command === "credits") {
    printTeamCredits(await getTeams());
    return;
  }

  if (command === "planet-counts") {
    try {
      printTeamPlanetCounts(await getTeamsDetailed());
    } catch (error) {
      if (error?.status === 403) {
        fail(
          "Impossible de compter les planetes des autres equipes: le detail /equipes/{id} est refuse (403) avec vos droits actuels."
        );
      }

      throw error;
    }
    return;
  }

  if (command === "cell") {
    const cellX = Number(shipName);
    const cellY = Number(x);

    if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) {
      fail("Il faut fournir x et y. Exemple: npm.cmd run game -- cell 5 40");
    }

    const [cell] = await getMap(cellX, cellX, cellY, cellY);
    printCell(cell);
    return;
  }

  if (command === "build-options") {
    const team = await getTeamState();
    printBuildOptions(team);
    const marketTypes = extractMarketShipTypes(await getMarketOffers());

    for (const type of getConstructibleShipTypes(team)) {
      const resolvedType = marketTypes.get(type.classeVaisseau);

      if (resolvedType) {
        console.log(
          `  -> type.id reel ${resolvedType.identifiant} | cout ${resolvedType.coutConstruction}`
        );
      }
    }
    return;
  }

  if (command === "rename-ship") {
    const oldName = shipName;
    const newName = [x, y].filter(Boolean).join(" ").trim();

    if (!oldName || !newName) {
      fail('Il faut fournir l’ancien et le nouveau nom. Exemple: rename-ship "Cargo L 1" "Cargo L Alpha"');
    }

    const ship = await findShipByName(oldName);
    console.log(`Renommage de ${ship.nom} -> ${newName}`);
    const result = await renameShip(ship.id, newName);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "build-cargo") {
    const team = await getTeamState();
    const constructibleCargo = getConstructibleShipTypes(team).find(
      (type) => type.classeVaisseau === "CARGO_LEGER"
    );

    if (!constructibleCargo) {
      fail("Aucun CARGO_LEGER constructible trouve.");
    }

    const marketTypes = extractMarketShipTypes(await getMarketOffers());
    const cargoType = marketTypes.get("CARGO_LEGER");

    if (!cargoType) {
      fail("Impossible de resoudre le vrai type.id du CARGO_LEGER.");
    }

    const shipNameToBuild = shipName || `Cargo ${Date.now()}`;
    console.log(
      `Construction de ${shipNameToBuild} sur ${constructibleCargo.planeteNom} (${cargoType.classeVaisseau})`
    );
    const result = await buildShip(
      shipNameToBuild,
      cargoType.identifiant,
      constructibleCargo.planeteIdentifiant
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "build-fighter") {
    const team = await getTeamState();
    const constructibleFighter = getConstructibleShipTypes(team).find(
      (type) => type.classeVaisseau === "CHASSEUR_LEGER"
    );

    if (!constructibleFighter) {
      fail("Aucun CHASSEUR_LEGER constructible trouve.");
    }

    const marketTypes = extractMarketShipTypes(await getMarketOffers());
    const fighterType = marketTypes.get("CHASSEUR_LEGER");

    if (!fighterType) {
      fail("Impossible de resoudre le vrai type.id du CHASSEUR_LEGER.");
    }

    const shipNameToBuild = shipName || `Chasseur ${Date.now()}`;
    console.log(
      `Construction de ${shipNameToBuild} sur ${constructibleFighter.planeteNom} (${fighterType.classeVaisseau})`
    );
    const result = await buildShip(
      shipNameToBuild,
      fighterType.identifiant,
      constructibleFighter.planeteIdentifiant
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "build-ship") {
    if (!shipName) {
      fail("Il faut fournir une classe de vaisseau. Exemple: build-ship CHASSEUR_MOYEN \"Nom\"");
    }

    const shipClass = String(shipName).toUpperCase();
    const customName = y ? [x, y].filter(Boolean).join(" ") : x;
    const [team, plans, marketOffers] = await Promise.all([
      getTeamState(),
      getPlans().catch(() => []),
      getMarketOffers().catch(() => [])
    ]);
    const constructibleType = findConstructibleType(team, shipClass);

    if (!constructibleType) {
      fail(`Aucun ${shipClass} constructible trouve sur vos planetes.`);
    }

    const shipNameToBuild = customName || `${shipClass}-${Date.now()}`;
    const buildOutcome = await tryBuildShip(
      shipNameToBuild,
      constructibleType,
      plans,
      marketOffers,
      shipClass
    );
    console.log(
      `Construction de ${shipNameToBuild} sur ${constructibleType.planeteNom} (${shipClass}, source ${buildOutcome.source}, type ${buildOutcome.typeId})`
    );
    if (buildOutcome.attempts.length > 0) {
      for (const attempt of buildOutcome.attempts) {
        console.log(
          `  - tentative ${attempt.source} (${attempt.typeId}) -> ${attempt.message}`
        );
      }
    }
    console.log(JSON.stringify(buildOutcome.result, null, 2));
    return;
  }

  if (command === "buy-advanced-yard") {
    const offers = await getMarketOffers();
    const moduleOffer = findCheapestModuleOffer(
      offers,
      "CONSTRUCTION_VAISSEAUX_AVANCEE"
    );

    if (!moduleOffer) {
      fail("Aucune offre CONSTRUCTION_VAISSEAUX_AVANCEE ouverte sur le marche.");
    }

    console.log(
      `Achat du module avance ${moduleOffer.offerId} pour ${moduleOffer.prix} credits`
    );
    const result = await buyOffer(moduleOffer.offerId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "place-advanced-yard") {
    const [team, modules] = await Promise.all([getTeamState(), getModules()]);
    const advancedModule = findOwnedModuleByType(
      modules,
      "CONSTRUCTION_VAISSEAUX_AVANCEE"
    );

    if (!advancedModule?.id && !advancedModule?.identifiant) {
      fail("Module CONSTRUCTION_VAISSEAUX_AVANCEE introuvable dans vos modules.");
    }

    const planet = findModulePlacementPlanet(team, 2, shipName);

    if (!planet?.identifiant) {
      fail("Aucune planete avec au moins 2 slots libres disponible pour poser le module.");
    }

    const moduleId = advancedModule.id ?? advancedModule.identifiant;
    console.log(`Pose du module avance sur ${planet.nom}`);
    const result = await placeModule(moduleId, planet.identifiant);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "buy-cargo-medium-plan") {
    const offers = await getMarketOffers();
    const cargoPlanOffer = findCheapestPlanOffer(offers, "CARGO_MOYEN");

    if (!cargoPlanOffer) {
      fail("Aucune offre de plan CARGO_MOYEN ouverte sur le marche.");
    }

    console.log(
      `Achat du plan cargo moyen ${cargoPlanOffer.offerId} pour ${cargoPlanOffer.prix} credits`
    );
    const result = await buyOffer(cargoPlanOffer.offerId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "build-cargo-medium") {
    const [team, plans] = await Promise.all([getTeamState(), getPlans()]);
    const buildType = resolveBuildTypeIdFromPlans(plans, "CARGO_MOYEN");

    if (!buildType?.typeId) {
      fail("Vous ne possedez pas de plan CARGO_MOYEN.");
    }

    const buildPlanet = findBuildPlanet(team, [
      "CONSTRUCTION_VAISSEAUX_AVANCEE"
    ]);

    if (!buildPlanet?.identifiant) {
      fail("Aucune planete avec CONSTRUCTION_VAISSEAUX_AVANCEE disponible.");
    }

    const shipNameToBuild = shipName || `Cargo moyen ${Date.now()}`;
    console.log(
      `Construction de ${shipNameToBuild} sur ${buildPlanet.nom} (${buildType.shipClass})`
    );
    const result = await buildShip(
      shipNameToBuild,
      buildType.typeId,
      buildPlanet.identifiant
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "buy-offer") {
    if (!shipName) {
      fail("Il faut fournir un id d'offre.");
    }

    console.log(`Achat de l'offre ${shipName}`);
    const result = await buyOffer(shipName);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "buy-plan") {
    if (!shipName) {
      fail("Il faut fournir une classe de vaisseau. Exemple: buy-plan CHASSEUR_MOYEN");
    }

    const shipClass = String(shipName).toUpperCase();
    const offers = await getMarketOffers();
    const planOffer = findCheapestPlanOffer(offers, shipClass);

    if (!planOffer?.offerId) {
      fail(`Aucune offre de plan ${shipClass} ouverte sur le marche.`);
    }

    console.log(
      `Achat du plan ${shipClass} ${planOffer.offerId} pour ${planOffer.prix} credits`
    );
    const result = await buyOffer(planOffer.offerId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "buy-cargo-plan") {
    const offers = await getMarketOffers();
    const cargoOffer = extractArray(offers).find((offer) => {
      const plan =
        offer.planVaisseau ??
        offer.plan ??
        offer.objet?.planVaisseau ??
        offer.objet?.plan ??
        null;

      return plan?.typeVaisseau?.classeVaisseau === "CARGO_LEGER";
    });

    if (!cargoOffer?.idOffre) {
      fail("Aucune offre de plan CARGO_LEGER ouverte sur le marche.");
    }

    console.log(
      `Achat du plan cargo ${cargoOffer.idOffre} pour ${cargoOffer.prix} credits`
    );
    const result = await buyOffer(cargoOffer.idOffre);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "buy-fighter-plan") {
    const offers = await getMarketOffers();
    const fighterOffer = findCheapestPlanOffer(offers, "CHASSEUR_LEGER");

    if (!fighterOffer?.offerId) {
      fail("Aucune offre de plan CHASSEUR_LEGER ouverte sur le marche.");
    }

    console.log(
      `Achat du plan chasseur ${fighterOffer.offerId} pour ${fighterOffer.prix} credits`
    );
    const result = await buyOffer(fighterOffer.offerId);
    console.log(JSON.stringify(result, null, 2));
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
  buyOffer,
  buildShip,
  findShipByName,
  getMap,
  getMarketOffers,
  getModules,
  getPlans,
  getShips,
  getTeams,
  getTeamsDetailed,
  getTeam,
  getTeamById,
  getTeamState,
  normalizeText,
  placeModule,
  requireConfig,
  sendShipAction
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
