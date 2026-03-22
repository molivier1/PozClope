import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const FULL_MAP = 58;
const BASE_CELL_SIZE = 50;
const CLICKABLE_PLANET_SQUARE_SIZE = 18;
const PLANET_RENDER_PADDING = 6;
const ENEMY_SHIP_STALE_TTL_MS = 20_000;
const DEMO_MODE_ENABLED = new URLSearchParams(window.location.search).get('demo') === '1';
const TEAM_COLOR_PALETTE = [
  '#6ff7ff',
  '#ff4d74',
  '#ffb347',
  '#8fff6f',
  '#8ab4ff',
  '#ffd86f',
  '#ff8ad8',
  '#b78cff',
  '#7fffd4',
  '#ff9a6f'
];
const ACTION_BUTTONS = [
  { action: 'DEPLACEMENT', label: 'Move', tone: 'neutral' },
  { action: 'ATTAQUER', label: 'Attack', tone: 'danger' },
  { action: 'CONQUERIR', label: 'Conquer', tone: 'accent' },
  { action: 'FARM_ZONE', label: 'Farm cargos', tone: 'accent' },
  { action: 'RECOLTER', label: 'Harvest', tone: 'accent' },
  { action: 'DEPOSER', label: 'Deposit', tone: 'accent' },
  { action: 'REPARER', label: 'Repair', tone: 'neutral' }
];
const SMART_ACTIONS = new Set(ACTION_BUTTONS.map((entry) => entry.action));

function buildDemoState() {
  return {
    teamId: 'demo',
    team: {
      nom: 'PozClope Demo',
      ressources: [
        { nom: 'CREDIT', quantite: 24500 },
        { nom: 'POINT', quantite: 87452 },
        { nom: 'MINERAI', quantite: 800 },
        { nom: 'VAISSEAU', quantite: 7 },
        { nom: 'EMPLACEMENT_VAISSEAU', quantite: 10 }
      ]
    },
    leaderboard: [
      { identifiant: '1', nom: 'PozClope', score: 87452, rang: 1, isCurrentTeam: true },
      { identifiant: '2', nom: "L'attribut de Dana", score: 81210, rang: 2, isCurrentTeam: false },
      { identifiant: '3', nom: 'Les inCESIssables', score: 79020, rang: 3, isCurrentTeam: false },
      { identifiant: '4', nom: 'Sudo Win', score: 70100, rang: 4, isCurrentTeam: false }
    ],
    ships: [
      {
        kind: 'ship',
        id: 'demo-amiral-1',
        displayName: 'Amiral 1',
        x: 35,
        y: 53,
        hp: 380,
        asset: 'AMIRAL',
        cargo: 0,
        className: 'AMIRAL',
        attack: 80,
        capacity: 0,
        cooldown: null,
        isEnemy: false,
        owner: 'PozClope Demo'
      },
      {
        kind: 'ship',
        id: 'demo-amiral-2',
        displayName: 'Amiral 2',
        x: 36,
        y: 52,
        hp: 380,
        asset: 'AMIRAL',
        cargo: 0,
        className: 'AMIRAL',
        attack: 80,
        capacity: 0,
        cooldown: null,
        isEnemy: false,
        owner: 'PozClope Demo'
      },
      {
        kind: 'ship',
        id: 'demo-cargo-1',
        displayName: 'Cargo L 1',
        x: 31,
        y: 49,
        hp: 200,
        asset: 'CARGO_LOURD',
        cargo: 200,
        className: 'CARGO_LOURD',
        attack: 0,
        capacity: 200,
        cooldown: null,
        isEnemy: false,
        owner: 'PozClope Demo'
      },
      {
        kind: 'ship',
        id: 'demo-enemy-1',
        displayName: 'Escort Dana',
        x: 41,
        y: 54,
        hp: 150,
        asset: 'CHASSEUR_MOYEN',
        cargo: 0,
        className: 'CHASSEUR_MOYEN',
        attack: 30,
        capacity: 0,
        cooldown: null,
        isEnemy: true,
        owner: "L'attribut de Dana"
      }
    ],
    planets: [
      {
        kind: 'planet',
        id: 'demo-planet-octant',
        displayName: 'Octant IV',
        x: 32,
        y: 50,
        hp: 500,
        minerals: 0,
        slots: 3,
        biome: 'aride',
        typePlanete: 'TELLURIQUE',
        owner: 'PozClope Demo',
        category: 'PLANET'
      },
      {
        kind: 'planet',
        id: 'demo-planet-target',
        displayName: 'Trade Nexus',
        x: 41,
        y: 53,
        hp: 320,
        minerals: 1400,
        slots: 4,
        biome: 'glace',
        typePlanete: 'TELLURIQUE',
        owner: "L'attribut de Dana",
        category: 'PLANET'
      },
      {
        kind: 'planet',
        id: 'demo-planet-neutral',
        displayName: 'Miranda',
        x: 38,
        y: 55,
        hp: 180,
        minerals: 900,
        slots: 2,
        biome: 'basique',
        typePlanete: 'CHAMPS_ASTEROIDES',
        owner: null,
        category: 'PLANET'
      }
    ]
  };
}

function normalizeAssetKey(value, fallback = '') {
  return String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildShipSources(asset) {
  const assetKey = normalizeAssetKey(asset, 'sonde');
  const preferredByType = {
    amiral: 'amiral_1',
    cargo_leger: 'cargo_leger_1',
    cargo_moyen: 'cargo_moyen_1',
    cargo_lourd: 'cargo_lourd_1',
    chasseur_leger: 'chasseur_leger_1',
    chasseur_moyen: 'chasseur_moyen_1',
    croiseur_moyen: 'croiseur_moyen_1',
    croiseur_lourd: 'croiseur_lourd_1',
    explorateur: 'sonde_1',
    sonde: 'sonde_1'
  };
  const preferredAsset = preferredByType[assetKey] ?? assetKey;
  const fallbacks = Array.from(new Set([preferredAsset, assetKey, 'sonde_1', 'sonde_2']));

  return fallbacks.map((name) => `/assets/assets 2d/vaisseaux_2D/${name}.png`);
}

function buildPlanetSource(planet) {
  const type = normalizeAssetKey(planet.typePlanete, 'tellurique');
  const biome = normalizeAssetKey(planet.biome, 'basique');

  if (type === 'champs_asteroides') {
    return '/assets/assets 2d/planets/champ_asteroides/planet12.svg';
  }

  const typeFolder = type === 'gazeuse' ? 'gazeuse' : 'tellurique';
  return `/assets/assets 2d/planets/${typeFolder}/${biome || 'basique'}.svg`;
}

function parseNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseCoordInputValue(value) {
  if (value === '' || value === null || value === undefined) {
    return Number.NaN;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function formatShipClassLabel(shipClass) {
  return String(shipClass ?? '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function isOpaqueTeamIdentifier(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return false;
  }

  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ||
    /^[0-9a-f]{32}$/i.test(text)
  );
}

function registerOwnerName(ownerLookup, ownerLike) {
  if (!ownerLookup || !ownerLike || typeof ownerLike !== 'object') {
    return;
  }

  const ownerId = ownerLike.identifiant ?? ownerLike.id ?? null;
  const ownerName = String(ownerLike.nom ?? ownerLike.name ?? '').trim();

  if (!ownerId || !ownerName || isOpaqueTeamIdentifier(ownerName)) {
    return;
  }

  ownerLookup.set(String(ownerId), ownerName);
}

function resolveOwnerName(ownerLike, ownerLookup, fallback = null) {
  if (!ownerLike) {
    return fallback;
  }

  if (typeof ownerLike === 'string') {
    const normalizedOwner = ownerLike.trim();

    if (!normalizedOwner) {
      return fallback;
    }

    const mappedOwner = ownerLookup?.get(normalizedOwner);
    if (mappedOwner) {
      return mappedOwner;
    }

    return isOpaqueTeamIdentifier(normalizedOwner) ? fallback : normalizedOwner;
  }

  const explicitName = String(ownerLike.nom ?? ownerLike.name ?? '').trim();
  if (explicitName && !isOpaqueTeamIdentifier(explicitName)) {
    return explicitName;
  }

  const ownerId = ownerLike.identifiant ?? ownerLike.id ?? null;
  if (ownerId != null) {
    const mappedOwner = ownerLookup?.get(String(ownerId));
    if (mappedOwner) {
      return mappedOwner;
    }

    const ownerIdText = String(ownerId).trim();
    if (ownerIdText && !isOpaqueTeamIdentifier(ownerIdText)) {
      return ownerIdText;
    }
  }

  return fallback;
}

function isGenericEnemyOwner(ownerName) {
  const normalized = String(ownerName ?? '').trim().toLowerCase();
  return !normalized || ['ennemi', 'inconnu', 'hostile'].includes(normalized);
}

function shortShipLabel(name) {
  if (!name) {
    return 'SHIP';
  }

  return name.length > 14 ? `${name.slice(0, 12)}..` : name;
}

function hashLabel(value) {
  const text = String(value ?? '');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getOwnerColor(ownerName, currentTeamName) {
  if (!ownerName) {
    return '#ffe1ff';
  }

  if (currentTeamName && ownerName === currentTeamName) {
    return '#6ff7ff';
  }

  return TEAM_COLOR_PALETTE[hashLabel(ownerName) % TEAM_COLOR_PALETTE.length];
}

function extractPlanetModuleTypes(planetLike) {
  return (planetLike?.modules ?? [])
    .map((module) => module?.typeModule ?? module?.paramModule?.typeModule ?? module?.moduleType ?? null)
    .filter(Boolean);
}

function hasPlanetModule(planetLike, moduleType) {
  return extractPlanetModuleTypes(planetLike).includes(moduleType);
}

function isAsteroidPlanet(planetLike) {
  return String(planetLike?.typePlanete ?? '').trim().toUpperCase() === 'CHAMPS_ASTEROIDES';
}

function isCapturablePlanet(planetLike, currentTeamName) {
  if (!planetLike) {
    return false;
  }

  if (isAsteroidPlanet(planetLike)) {
    return false;
  }

  if (hasPlanetModule(planetLike, 'GOUVERNANCE_PLANETAIRE')) {
    return false;
  }

  return !planetLike.owner || planetLike.owner !== currentTeamName;
}

function getPlanetBadges(planetLike, currentTeamName) {
  const badges = [];

  if (hasPlanetModule(planetLike, 'GOUVERNANCE_PLANETAIRE')) {
    badges.push({ key: 'capital', label: 'Capitale', tone: 'danger' });
  }

  if (hasPlanetModule(planetLike, 'DECHARGEMENT_RESSOURCE')) {
    badges.push({ key: 'deposit', label: 'Depot', tone: 'ally' });
  }

  if (
    hasPlanetModule(planetLike, 'CONSTRUCTION_VAISSEAUX') ||
    hasPlanetModule(planetLike, 'CONSTRUCTION_VAISSEAUX_AVANCEE')
  ) {
    badges.push({ key: 'shipyard', label: 'Chantier', tone: 'warn' });
  }

  if (isAsteroidPlanet(planetLike)) {
    badges.push({ key: 'asteroid', label: 'Asteroides', tone: 'neutral' });
  }

  if (isCapturablePlanet(planetLike, currentTeamName)) {
    badges.push({ key: 'capturable', label: 'Capturable', tone: 'accent' });
  }

  return badges;
}

function matchesPlanetFilter(planetLike, filterMode, currentTeamName) {
  if (filterMode === 'capturable') {
    return isCapturablePlanet(planetLike, currentTeamName);
  }

  if (filterMode === 'strategic') {
    return getPlanetBadges(planetLike, currentTeamName).some((badge) =>
      ['deposit', 'shipyard', 'capital'].includes(badge.key)
    );
  }

  if (filterMode === 'owned') {
    return Boolean(planetLike.owner && planetLike.owner === currentTeamName);
  }

  return true;
}

function chooseNearestPlanet(originPoint, planets, predicate) {
  const candidates = planets.filter(predicate);

  if (!candidates.length) {
    return null;
  }

  if (!originPoint) {
    return candidates[0];
  }

  return [...candidates].sort((left, right) => {
    const leftDistance = Math.max(Math.abs(left.x - originPoint.x), Math.abs(left.y - originPoint.y));
    const rightDistance = Math.max(Math.abs(right.x - originPoint.x), Math.abs(right.y - originPoint.y));
    return leftDistance - rightDistance;
  })[0];
}

function getShipReadyDelayMs(ship) {
  if (!ship?.cooldown) {
    return 0;
  }

  if (typeof ship.cooldown === 'number') {
    return ship.cooldown > 0 ? ship.cooldown * 1000 : 0;
  }

  const parsed = new Date(ship.cooldown);

  if (!Number.isFinite(parsed.getTime())) {
    return 0;
  }

  return Math.max(parsed.getTime() - Date.now(), 0);
}

function getResourceQuantity(team, resourceName) {
  const normalizedName = String(resourceName).toUpperCase();
  const resource = (team?.ressources ?? []).find((entry) => {
    const type = String(entry.type ?? '').toUpperCase();
    const label = String(entry.nom ?? '').toUpperCase();
    return type === normalizedName || label === normalizedName;
  });

  return Number(resource?.quantite ?? 0);
}

function formatActionLabel(action) {
  return ACTION_BUTTONS.find((entry) => entry.action === action)?.label ?? action;
}

function clampRangeValue(value) {
  return Math.max(0, Math.min(FULL_MAP - 1, Math.round(value)));
}

function buildRangeQuery(range) {
  return `x_range=${range.x[0]},${range.x[1]}&y_range=${range.y[0]},${range.y[1]}`;
}

function computeFocusRange(friendlyShips, selected, selectedShips, actionTargetPoint) {
  let squadAnchors = [];

  if (selectedShips.length > 0) {
    squadAnchors = selectedShips;
  } else if (selected && selected.kind === 'ship' && !selected.isEnemy) {
    squadAnchors = [selected];
  } else if (friendlyShips.length > 0) {
    const anchor = friendlyShips[0];
    squadAnchors = [...friendlyShips]
      .sort((left, right) => {
        const leftDistance = Math.abs(left.x - anchor.x) + Math.abs(left.y - anchor.y);
        const rightDistance = Math.abs(right.x - anchor.x) + Math.abs(right.y - anchor.y);
        return leftDistance - rightDistance;
      })
      .slice(0, 4);
  }

  const anchors = [
    ...squadAnchors,
    ...(selected && (selected.kind === 'planet' || selected.isEnemy) ? [selected] : []),
    ...(actionTargetPoint ? [actionTargetPoint] : [])
  ].filter(Boolean);

  if (anchors.length === 0) {
    return {
      x: [0, FULL_MAP - 1],
      y: [0, FULL_MAP - 1]
    };
  }

  const bounds = anchors.reduce(
    (accumulator, item) => ({
      minX: Math.min(accumulator.minX, item.x),
      maxX: Math.max(accumulator.maxX, item.x),
      minY: Math.min(accumulator.minY, item.y),
      maxY: Math.max(accumulator.maxY, item.y)
    }),
    {
      minX: anchors[0].x,
      maxX: anchors[0].x,
      minY: anchors[0].y,
      maxY: anchors[0].y
    }
  );
  const padding = 10;

  return {
    x: [clampRangeValue(bounds.minX - padding), clampRangeValue(bounds.maxX + padding)],
    y: [clampRangeValue(bounds.minY - padding), clampRangeValue(bounds.maxY + padding)]
  };
}

function parseSnapshot(stateData, mapCells, ownerLookup = new Map()) {
  const parsedShips = (stateData.ships ?? []).map((ship, index) => ({
    kind: 'ship',
    id: String(ship.identifiant ?? ship.id ?? `${ship.nom}-${index}`),
    displayName: ship.nom ?? `Vaisseau ${index + 1}`,
    x: parseNumber(ship.coord_x ?? ship.x ?? ship.positionX),
    y: parseNumber(ship.coord_y ?? ship.y ?? ship.positionY),
    hp: parseNumber(ship.pointDeVie),
    asset: ship.type ?? ship.typeNom ?? ship.modeleVaisseau?.nom ?? ship.classeVaisseau ?? 'sonde',
    cargo: parseNumber(ship.mineraiTransporte),
    className: ship.classeVaisseau ?? ship.classe ?? 'INCONNU',
    attack: parseNumber(ship.attaque),
    capacity: parseNumber(ship.capaciteTransport),
    cooldown: ship.dateProchaineAction ?? null,
    isEnemy: false,
    owner: stateData.team?.nom ?? 'PozClope'
  }));
  const parsedPlanets = [];
  const enemyShips = [];

  mapCells.forEach((cell, cellIndex) => {
    const cellX = parseNumber(cell.coord_x ?? cell.x);
    const cellY = parseNumber(cell.coord_y ?? cell.y);

    if (cell.planete && !cell.planete.estVide) {
      parsedPlanets.push({
        kind: 'planet',
        id: String(cell.planete.identifiant ?? `planet-${cellX}-${cellY}-${cellIndex}`),
        displayName: cell.planete.nom ?? `Planete ${cellX}:${cellY}`,
        x: parseNumber(cell.planete.coord_x ?? cellX),
        y: parseNumber(cell.planete.coord_y ?? cellY),
        hp: parseNumber(cell.planete.pointDeVie),
        minerals: parseNumber(cell.planete.mineraiDisponible),
        slots: parseNumber(cell.planete.slotsConstruction),
        biome: cell.planete.biome ?? cell.planete.modelePlanete?.biome,
        typePlanete: cell.planete.typePlanete ?? cell.planete.modelePlanete?.typePlanete,
        owner: resolveOwnerName(cell.proprietaire, ownerLookup, null),
        modules: extractPlanetModuleTypes(cell.planete),
        category: 'PLANET'
      });
    }

    (cell.vaisseaux ?? []).forEach((ship, shipIndex) => {
      if (!ship.proprietaire || String(ship.proprietaire.identifiant) === String(stateData.teamId)) {
        return;
      }

      enemyShips.push({
        kind: 'ship',
        id: String(ship.identifiant ?? `${ship.nom}-${shipIndex}-${cellX}-${cellY}`),
        displayName: ship.nom ?? 'Vaisseau Ennemi',
        x: parseNumber(ship.coord_x ?? ship.x),
        y: parseNumber(ship.coord_y ?? ship.y),
        hp: parseNumber(ship.pointDeVie),
        asset: ship.type ?? ship.typeNom ?? ship.modeleVaisseau?.nom ?? ship.classeVaisseau ?? 'sonde',
        cargo: parseNumber(ship.mineraiTransporte),
        className: ship.classeVaisseau ?? 'ENEMY',
        isEnemy: true,
        owner: resolveOwnerName(ship.proprietaire, ownerLookup, null)
      });
    });
  });

  return {
    friendlyShips: parsedShips,
    enemyShips,
    planets: parsedPlanets
  };
}

function parsePlanetCatalog(mapCells, ownerLookup = new Map()) {
  const parsedPlanets = [];

  mapCells.forEach((cell, cellIndex) => {
    const cellX = parseNumber(cell.coord_x ?? cell.x);
    const cellY = parseNumber(cell.coord_y ?? cell.y);

    if (!cell.planete || cell.planete.estVide) {
      return;
    }

    parsedPlanets.push({
      kind: 'planet',
      id: String(cell.planete.identifiant ?? `planet-${cellX}-${cellY}-${cellIndex}`),
      displayName: cell.planete.nom ?? `Planete ${cellX}:${cellY}`,
      x: parseNumber(cell.planete.coord_x ?? cellX),
      y: parseNumber(cell.planete.coord_y ?? cellY),
      hp: parseNumber(cell.planete.pointDeVie),
      minerals: parseNumber(cell.planete.mineraiDisponible),
      slots: parseNumber(cell.planete.slotsConstruction),
      biome: cell.planete.biome ?? cell.planete.modelePlanete?.biome,
      typePlanete: cell.planete.typePlanete ?? cell.planete.modelePlanete?.typePlanete,
      owner: resolveOwnerName(cell.proprietaire, ownerLookup, null),
      modules: extractPlanetModuleTypes(cell.planete),
      category: 'PLANET'
    });
  });

  return parsedPlanets;
}

function parseGlobalEnemyShips(payload, teamId, ownerLookup = new Map()) {
  return (payload?.ships ?? [])
    .filter((ship) => String(ship.proprietaire?.identifiant ?? '') !== String(teamId ?? ''))
    .map((ship, index) => ({
      kind: 'ship',
      id: String(ship.identifiant ?? ship.id ?? `enemy-${index}`),
      displayName: ship.nom ?? 'Vaisseau Ennemi',
      x: parseNumber(ship.coord_x ?? ship.x),
      y: parseNumber(ship.coord_y ?? ship.y),
      hp: parseNumber(ship.pointDeVie),
      asset: ship.type ?? ship.typeNom ?? ship.modeleVaisseau?.nom ?? ship.classeVaisseau ?? 'sonde',
      cargo: parseNumber(ship.mineraiTransporte),
      className: ship.classeVaisseau ?? ship.classe ?? 'ENEMY',
      attack: parseNumber(ship.attaque),
      capacity: parseNumber(ship.capaciteTransport),
      cooldown: ship.dateProchaineAction ?? null,
      isEnemy: true,
      owner: resolveOwnerName(ship.proprietaire, ownerLookup, null)
    }));
}

function mergePlanets(previousPlanets, nextPlanets) {
  const byId = new Map(previousPlanets.map((planet) => [planet.id, planet]));

  nextPlanets.forEach((planet) => {
    byId.set(planet.id, planet);
  });

  return [...byId.values()];
}

function markEnemyShipsSeen(enemyShips, seenAt) {
  return enemyShips.map((ship) => ({
    ...ship,
    lastSeenAt: seenAt
  }));
}

function mergeEnemyShips(
  previousEnemyShips,
  nextEnemyShips,
  {
    seenAt = Date.now(),
    staleTtlMs = ENEMY_SHIP_STALE_TTL_MS
  } = {}
) {
  const byId = new Map(previousEnemyShips.map((ship) => [ship.id, ship]));

  nextEnemyShips.forEach((ship) => {
    const previous = byId.get(ship.id);
    const nextOwner = isGenericEnemyOwner(ship.owner) ? previous?.owner ?? null : ship.owner;
    byId.set(ship.id, {
      ...previous,
      ...ship,
      owner: nextOwner,
      lastSeenAt: seenAt
    });
  });

  return [...byId.values()].filter((ship) => seenAt - Number(ship.lastSeenAt ?? 0) <= staleTtlMs);
}

const ShipImage = ({ ship }) => {
  const [errorLevel, setErrorLevel] = useState(0);
  const sources = buildShipSources(ship.asset);

  useEffect(() => {
    setErrorLevel(0);
  }, [ship.asset]);

  if (errorLevel >= sources.length) {
    return (
      <div
        className={`ship-fallback ${ship.isEnemy ? 'enemy' : 'friendly'}`}
        title={ship.displayName}
      />
    );
  }

  return (
    <img
      src={sources[errorLevel]}
      className={`asset-img ship-img ${ship.isEnemy ? 'enemy' : 'friendly'}`}
      alt={ship.displayName}
      title={ship.displayName}
      draggable={false}
      onError={() => setErrorLevel((previous) => previous + 1)}
    />
  );
};

const PlanetImage = ({ planet }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [planet.id, planet.biome, planet.typePlanete]);

  if (hasError) {
    return <div className={`planet-fallback ${planet.owner ? 'owned' : 'neutral'}`} title={planet.displayName} />;
  }

  return (
    <img
      src={buildPlanetSource(planet)}
      className={`planet-img ${planet.owner ? 'owned' : 'neutral'}`}
      alt={planet.displayName}
      title={planet.displayName}
      draggable={false}
      onError={() => setHasError(true)}
    />
  );
};

function App() {
  const [ships, setShips] = useState([]);
  const [planets, setPlanets] = useState([]);
  const [team, setTeam] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);
  const [selectedShipIds, setSelectedShipIds] = useState([]);
  const [actionTarget, setActionTarget] = useState({ x: '', y: '' });
  const [actionFeedback, setActionFeedback] = useState(null);
  const [actionPending, setActionPending] = useState('');
  const [activeCommandPlan, setActiveCommandPlan] = useState(null);
  const [buildPanelOpen, setBuildPanelOpen] = useState(false);
  const [buildOptions, setBuildOptions] = useState([]);
  const [buildOptionsPending, setBuildOptionsPending] = useState(false);
  const [buildSelectionKey, setBuildSelectionKey] = useState('');
  const [buildShipName, setBuildShipName] = useState('');
  const [buildPending, setBuildPending] = useState(false);
  const [siegePanelOpen, setSiegePanelOpen] = useState(false);
  const [siegePending, setSiegePending] = useState(false);
  const [siegeIncludeNeutral, setSiegeIncludeNeutral] = useState(true);
  const [siegeStatus, setSiegeStatus] = useState({
    running: false,
    logs: [],
    shipNames: [],
    includeNeutralTargets: false
  });
  const [planetFilter, setPlanetFilter] = useState('all');
  const [orderLog, setOrderLog] = useState([]);
  const [hasCentered, setHasCentered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const fetchInFlightRef = useRef(false);
  const dragPointerRef = useRef(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef(null);
  const autoCommandPendingRef = useRef(false);
  const liveContextRef = useRef({
    friendlyShips: [],
    selected: null,
    selectedShips: [],
    actionTargetPoint: null
  });
  const leaderboardFetchedAtRef = useRef(0);
  const enemyShipsFetchedAtRef = useRef(0);
  const planetsFetchedAtRef = useRef(0);
  const ownerNameByIdRef = useRef(new Map());

  useEffect(() => () => {
    if (suppressClickTimeoutRef.current) {
      window.clearTimeout(suppressClickTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dragging-map', isDragging);
    return () => {
      document.body.classList.remove('dragging-map');
    };
  }, [isDragging]);

  const fetchData = async ({ mode = 'focus', forceLeaderboard = false } = {}) => {
    if (fetchInFlightRef.current) {
      return;
    }

    fetchInFlightRef.current = true;

    try {
      const range =
        mode === 'initial'
          ? { x: [0, FULL_MAP - 1], y: [0, FULL_MAP - 1] }
          : computeFocusRange(
              liveContextRef.current.friendlyShips,
              liveContextRef.current.selected,
              liveContextRef.current.selectedShips,
              liveContextRef.current.actionTargetPoint
            );
      const shouldFetchLeaderboard =
        forceLeaderboard || Date.now() - leaderboardFetchedAtRef.current > 20_000;
      const shouldFetchEnemyShips =
        forceLeaderboard || Date.now() - enemyShipsFetchedAtRef.current > 12_000;
      const shouldFetchPlanetCatalog =
        mode === 'initial' ||
        planets.length === 0 ||
        Date.now() - planetsFetchedAtRef.current > 45_000;
      const requests = [fetch(`/api/state?${buildRangeQuery(range)}&include_plan=0`)];
      let leaderboardIndex = -1;
      let enemyShipsIndex = -1;
      let planetsIndex = -1;

      if (shouldFetchLeaderboard) {
        leaderboardIndex = requests.length;
        requests.push(fetch('/api/leaderboard').catch(() => null));
      }

      if (shouldFetchEnemyShips) {
        enemyShipsIndex = requests.length;
        requests.push(fetch('/api/vaisseaux/all').catch(() => null));
      }

      if (shouldFetchPlanetCatalog) {
        planetsIndex = requests.length;
        requests.push(fetch(`/api/map?x_range=0,${FULL_MAP - 1}&y_range=0,${FULL_MAP - 1}`).catch(() => null));
      }

      const settledResults = await Promise.allSettled(requests);
      const stateResult = settledResults[0];
      const leaderResult = leaderboardIndex >= 0 ? settledResults[leaderboardIndex] : null;
      const enemyShipsResult = enemyShipsIndex >= 0 ? settledResults[enemyShipsIndex] : null;
      const planetsResult = planetsIndex >= 0 ? settledResults[planetsIndex] : null;

      if (stateResult.status !== 'fulfilled' || !stateResult.value.ok) {
        const status = stateResult.status === 'fulfilled' ? stateResult.value.status : 'offline';
        throw new Error(`API error: ${status}`);
      }

      const stateData = await stateResult.value.json();
      const enemyShipsPayload =
        shouldFetchEnemyShips &&
        enemyShipsResult?.status === 'fulfilled' &&
        enemyShipsResult.value &&
        enemyShipsResult.value.ok
          ? await enemyShipsResult.value.json()
          : null;
      const planetsPayload =
        shouldFetchPlanetCatalog &&
        planetsResult?.status === 'fulfilled' &&
        planetsResult.value &&
        planetsResult.value.ok
          ? await planetsResult.value.json()
          : null;
      const ownerLookup = new Map(ownerNameByIdRef.current);

      registerOwnerName(ownerLookup, {
        identifiant: stateData.teamId,
        nom: stateData.team?.nom
      });
      (stateData.cells || []).forEach((cell) => {
        registerOwnerName(ownerLookup, cell.proprietaire);
        (cell.vaisseaux ?? []).forEach((ship) => {
          registerOwnerName(ownerLookup, ship.proprietaire);
        });
      });
      (enemyShipsPayload?.ships ?? []).forEach((ship) => {
        registerOwnerName(ownerLookup, ship.proprietaire);
      });
      ownerNameByIdRef.current = ownerLookup;

      const parsed = parseSnapshot(stateData, stateData.cells || [], ownerLookup);
      const snapshotSeenAt = Date.now();
      const globalEnemyShips = enemyShipsPayload
        ? markEnemyShipsSeen(
            parseGlobalEnemyShips(enemyShipsPayload, stateData.teamId, ownerLookup),
            snapshotSeenAt
          )
        : null;
      const localEnemyShips = markEnemyShipsSeen(parsed.enemyShips, snapshotSeenAt);
      const globalPlanets = planetsPayload
        ? parsePlanetCatalog(planetsPayload.cells || [], ownerLookup)
        : null;
      setLastSyncedAt(stateData.fetchedAt ?? new Date().toISOString());

      setTeam(stateData.team ?? null);
      setTeamId(stateData.teamId ?? null);
      setShips((previousShips) => {
        const previousEnemyShips = previousShips.filter((ship) => ship.isEnemy);
        const nextEnemyShips = globalEnemyShips
          ? mergeEnemyShips(previousEnemyShips, globalEnemyShips, { seenAt: snapshotSeenAt })
          : mergeEnemyShips(previousEnemyShips, localEnemyShips, { seenAt: snapshotSeenAt });

        if (mode === 'initial' || previousShips.length === 0) {
          return [...parsed.friendlyShips, ...nextEnemyShips];
        }

        return [
          ...parsed.friendlyShips,
          ...nextEnemyShips
        ];
      });
      setPlanets((previousPlanets) =>
        globalPlanets
          ? mergePlanets(globalPlanets, parsed.planets)
          : mode === 'initial' || previousPlanets.length === 0
            ? parsed.planets
            : mergePlanets(previousPlanets, parsed.planets)
      );
      setFetchError('');

      if (
        shouldFetchLeaderboard &&
        leaderResult?.status === 'fulfilled' &&
        leaderResult.value &&
        leaderResult.value.ok
      ) {
        const leaderData = await leaderResult.value.json();
        if (leaderData.leaderboard) {
          setLeaderboard(leaderData.leaderboard);
        }
        leaderboardFetchedAtRef.current = Date.now();
      }

      if (globalEnemyShips) {
        enemyShipsFetchedAtRef.current = Date.now();
      }

      if (globalPlanets) {
        planetsFetchedAtRef.current = Date.now();
      }
    } catch (error) {
      console.error('Fetch failed:', error);
      setFetchError(error.message || 'Connexion impossible');

      if (DEMO_MODE_ENABLED && ships.length === 0 && planets.length === 0) {
        const demoState = buildDemoState();
        setTeam(demoState.team);
        setTeamId(demoState.teamId);
        setShips(demoState.ships);
        setPlanets(demoState.planets);
        setLeaderboard(demoState.leaderboard);
      }
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData({ mode: 'initial', forceLeaderboard: true });
    const interval = setInterval(() => {
      const hasFleet = liveContextRef.current.friendlyShips.length > 0;
      fetchData({
        mode: hasFleet ? 'focus' : 'initial'
      });
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const friendlyShips = useMemo(
    () => ships.filter((ship) => !ship.isEnemy).sort((left, right) => left.displayName.localeCompare(right.displayName, 'fr')),
    [ships]
  );
  const enemyShips = useMemo(() => ships.filter((ship) => ship.isEnemy), [ships]);
  const friendlyShipsById = useMemo(
    () => new Map(friendlyShips.map((ship) => [ship.id, ship])),
    [friendlyShips]
  );
  const selectedShips = useMemo(
    () => selectedShipIds.map((shipId) => friendlyShipsById.get(shipId)).filter(Boolean),
    [friendlyShipsById, selectedShipIds]
  );

  useEffect(() => {
    const parsedTargetX = parseCoordInputValue(actionTarget.x);
    const parsedTargetY = parseCoordInputValue(actionTarget.y);
    const actionTargetPoint =
      Number.isFinite(parsedTargetX) && Number.isFinite(parsedTargetY)
        ? { x: parsedTargetX, y: parsedTargetY, kind: 'target' }
        : null;

    liveContextRef.current = {
      friendlyShips,
      selected,
      selectedShips,
      actionTargetPoint
    };
  }, [actionTarget.x, actionTarget.y, friendlyShips, selected, selectedShips]);

  useEffect(() => {
    setSelectedShipIds((previous) => previous.filter((shipId) => friendlyShipsById.has(shipId)));
  }, [friendlyShipsById]);

  useEffect(() => {
    if (hasCentered) {
      return;
    }

    const leadShip = friendlyShips[0];

    if (!leadShip) {
      return;
    }
    const centerX = (leadShip.x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
    const centerY = (leadShip.y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
    setViewport({
      x: (window.innerWidth / 2) - (centerX * zoom),
      y: (window.innerHeight / 2) - (centerY * zoom)
    });
    setHasCentered(true);
  }, [friendlyShips, hasCentered, zoom]);

  useEffect(() => {
    if (!selected) {
      return;
    }

    if (selected.kind === 'ship') {
      const updatedShip = ships.find((ship) => ship.id === selected.id);
      if (updatedShip) {
        setSelected(updatedShip);
      }
      return;
    }

    const updatedPlanet = planets.find((planet) => planet.id === selected.id);
    if (updatedPlanet) {
      setSelected(updatedPlanet);
    }
  }, [planets, selected, ships]);

  useEffect(() => {
    if (!selected) {
      return;
    }

    if (selected.kind === 'planet' || selected.isEnemy) {
      setActionTarget({
        x: String(selected.x),
        y: String(selected.y)
      });
    }
  }, [selected]);

  useEffect(() => {
    if (!activeCommandPlan || actionPending || autoCommandPendingRef.current) {
      return undefined;
    }

    const completedIds = new Set(activeCommandPlan.completedShipIds ?? []);
    const pendingShipIds = activeCommandPlan.shipIds.filter((shipId) => !completedIds.has(shipId));
    const plannedShips = pendingShipIds
      .map((shipId) => friendlyShipsById.get(shipId))
      .filter(Boolean);

    if (pendingShipIds.length === 0 || plannedShips.length === 0) {
      appendLog(
        `${formatActionLabel(activeCommandPlan.action)} termine vers [${activeCommandPlan.targetX}:${activeCommandPlan.targetY}].`,
        'success'
      );
      setActiveCommandPlan(null);
      return undefined;
    }

    const readyShipIds = plannedShips
      .filter((ship) => getShipReadyDelayMs(ship) <= 0)
      .map((ship) => ship.id);

    if (readyShipIds.length === 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      executeAction(activeCommandPlan.action, {
        shipIds: readyShipIds,
        targetX: activeCommandPlan.targetX,
        targetY: activeCommandPlan.targetY,
        silent: true,
        preserveCommandPlan: true
      });
    }, activeCommandPlan.action === 'FARM_ZONE' ? 1800 : 120);

    return () => window.clearTimeout(timeoutId);
  }, [actionPending, activeCommandPlan, friendlyShipsById]);

  const visiblePlanetCells = useMemo(() => {
    const visibleCells = new Set();
    const halfSquare = Math.floor(CLICKABLE_PLANET_SQUARE_SIZE / 2);

    friendlyShips.forEach((ship) => {
      for (let offsetY = -halfSquare; offsetY <= halfSquare; offsetY += 1) {
        for (let offsetX = -halfSquare; offsetX <= halfSquare; offsetX += 1) {
          const cellX = ship.x + offsetX;
          const cellY = ship.y + offsetY;

          if (cellX < 0 || cellX >= FULL_MAP || cellY < 0 || cellY >= FULL_MAP) {
            continue;
          }

          visibleCells.add(`${cellX},${cellY}`);
        }
      }
    });

    return visibleCells;
  }, [friendlyShips]);

  const renderedPlanets = useMemo(
    () =>
      planets
        .map((planet) => {
          const badges = getPlanetBadges(planet, team?.nom);

          return {
            ...planet,
            cellKey: `${planet.x},${planet.y}`,
            isVisible: visiblePlanetCells.has(`${planet.x},${planet.y}`),
            isSelected: selected?.kind === 'planet' && selected.id === planet.id,
            isOwned: Boolean(planet.owner && planet.owner === team?.nom),
            isCapturable: isCapturablePlanet(planet, team?.nom),
            badges,
            ownerColor: getOwnerColor(planet.owner, team?.nom)
          };
        })
        .filter((planet) => matchesPlanetFilter(planet, planetFilter, team?.nom)),
    [planets, selected, team?.nom, visiblePlanetCells, planetFilter]
  );

  const renderedShips = useMemo(
    () =>
      ships.map((ship) => ({
        ...ship,
        cellKey: `${ship.x},${ship.y}`,
        isSelected: selected?.kind === 'ship' && selected.id === ship.id,
        isSquadMember: selectedShipIds.includes(ship.id)
      })),
    [selected, selectedShipIds, ships]
  );

  const squadCenter = useMemo(() => {
    const anchorShips = selectedShips.length > 0 ? selectedShips : friendlyShips;

    if (!anchorShips.length) {
      return null;
    }

    const total = anchorShips.reduce(
      (accumulator, ship) => ({
        x: accumulator.x + ship.x,
        y: accumulator.y + ship.y
      }),
      { x: 0, y: 0 }
    );

    return {
      x: total.x / anchorShips.length,
      y: total.y / anchorShips.length
    };
  }, [friendlyShips, selectedShips]);

  const credits = getResourceQuantity(team, 'CREDIT');
  const points = getResourceQuantity(team, 'POINT');
  const minerai = getResourceQuantity(team, 'MINERAI');
  const fleetSlots = getResourceQuantity(team, 'VAISSEAU');
  const fleetCapacity = getResourceQuantity(team, 'EMPLACEMENT_VAISSEAU');
  const validTargetX = parseCoordInputValue(actionTarget.x);
  const validTargetY = parseCoordInputValue(actionTarget.y);
  const hasActionTarget = Number.isFinite(validTargetX) && Number.isFinite(validTargetY);
  const lastSyncLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('fr-FR')
    : '--:--:--';
  const buildSelection = buildOptions.find((option) => (
    `${option.shipClass}:${option.planetId}` === buildSelectionKey
  )) ?? null;

  const appendLog = (label, tone = 'neutral') => {
    setOrderLog((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label,
        tone
      },
      ...previous
    ].slice(0, 14));
  };

  const loadSiegeStatus = async () => {
    try {
      const response = await fetch('/api/automation/siege-plus');
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      setSiegeStatus(payload);
      setSiegeIncludeNeutral(Boolean(payload.includeNeutralTargets));
    } catch (error) {
      console.warn('Siege+ status impossible:', error.message);
    }
  };

  const handleToggleSiegePanel = async () => {
    const nextOpen = !siegePanelOpen;
    setSiegePanelOpen(nextOpen);

    if (nextOpen) {
      await loadSiegeStatus();
    }
  };

  const handleStartSiege = async () => {
    const shipIds = selectedShipIds.length > 0
      ? selectedShipIds
      : friendlyShips.filter((ship) => !ship.className.includes('CARGO')).map((ship) => ship.id);

    if (!shipIds.length) {
      appendLog('Siege+ impossible: aucune escouade de combat selectionnee.', 'danger');
      return;
    }

    try {
      setSiegePending(true);
      const response = await fetch('/api/automation/siege-plus/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shipIds,
          includeNeutralTargets: siegeIncludeNeutral
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      setSiegeStatus(payload);
      appendLog(`Siege+ lance avec ${payload.shipNames?.length ?? shipIds.length} vaisseaux.`, 'success');
    } catch (error) {
      appendLog(`Siege+ impossible: ${error.message}`, 'danger');
    } finally {
      setSiegePending(false);
    }
  };

  const handleStopSiege = async () => {
    try {
      setSiegePending(true);
      const response = await fetch('/api/automation/siege-plus/stop', {
        method: 'POST'
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      setSiegeStatus(payload);
      appendLog('Siege+ stoppe.', 'warn');
    } catch (error) {
      appendLog(`Arret Siege+ impossible: ${error.message}`, 'danger');
    } finally {
      setSiegePending(false);
    }
  };

  useEffect(() => {
    if (!siegePanelOpen && !siegeStatus.running) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      loadSiegeStatus();
    }, siegeStatus.running ? 2000 : 5000);

    return () => window.clearInterval(interval);
  }, [siegePanelOpen, siegeStatus.running]);

  const suggestShipName = (option) => {
    if (!option) {
      return '';
    }

    const siblingCount = ships.filter(
      (ship) => !ship.isEnemy && ship.className === option.shipClass
    ).length;
    return `${formatShipClassLabel(option.shipClass)} ${siblingCount + 1}`;
  };

  const loadBuildOptions = async ({ openPanel = false } = {}) => {
    try {
      setBuildOptionsPending(true);
      const response = await fetch('/api/build/options');
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      const options = Array.isArray(payload.options) ? payload.options : [];
      setBuildOptions(options);

      if (openPanel) {
        setBuildPanelOpen(true);
      }

      if (!options.length) {
        setBuildSelectionKey('');
        setBuildShipName('');
        appendLog('Aucun vaisseau constructible pour le moment.', 'warn');
        return;
      }

      const nextSelectionKey = options.some(
        (option) => `${option.shipClass}:${option.planetId}` === buildSelectionKey
      )
        ? buildSelectionKey
        : `${options[0].shipClass}:${options[0].planetId}`;
      const nextSelection = options.find(
        (option) => `${option.shipClass}:${option.planetId}` === nextSelectionKey
      ) ?? options[0];

      setBuildSelectionKey(nextSelectionKey);
      setBuildShipName((current) => current || suggestShipName(nextSelection));
    } catch (error) {
      appendLog(`Build impossible: ${error.message}`, 'danger');
    } finally {
      setBuildOptionsPending(false);
    }
  };

  const handleToggleBuildPanel = async () => {
    if (buildPanelOpen) {
      setBuildPanelOpen(false);
      return;
    }

    await loadBuildOptions({ openPanel: true });
  };

  const handleBuildSelectionChange = (event) => {
    const nextKey = event.target.value;
    const nextSelection = buildOptions.find(
      (option) => `${option.shipClass}:${option.planetId}` === nextKey
    ) ?? null;

    setBuildSelectionKey(nextKey);
    setBuildShipName((current) => (
      current && current.trim() ? current : suggestShipName(nextSelection)
    ));
  };

  const handleBuildShip = async () => {
    if (!buildSelection) {
      appendLog('Aucun modele de construction selectionne.', 'danger');
      return;
    }

    const shipName = buildShipName.trim() || suggestShipName(buildSelection);

    try {
      setBuildPending(true);
      const response = await fetch('/api/build/ships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shipClass: buildSelection.shipClass,
          planetId: buildSelection.planetId,
          shipName
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      appendLog(
        `${shipName} construit sur ${payload.planetName} (${payload.shipClass})`,
        'success'
      );
      setBuildShipName(suggestShipName(buildSelection));
      await loadBuildOptions();
      await fetchData({ mode: 'initial', forceLeaderboard: true });
    } catch (error) {
      appendLog(`Construction impossible: ${error.message}`, 'danger');
    } finally {
      setBuildPending(false);
    }
  };

  const centerViewport = (x, y) => {
    const targetX = (x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
    const targetY = (y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);

    setViewport({
      x: (window.innerWidth / 2) - (targetX * zoom),
      y: (window.innerHeight / 2) - (targetY * zoom)
    });
  };

  const toggleShipSelection = (ship) => {
    setSelected(ship);
    setSelectedShipIds((previous) =>
      previous.includes(ship.id)
        ? previous.filter((shipId) => shipId !== ship.id)
        : [...previous, ship.id]
    );
  };

  const selectShipPreset = (preset) => {
    let nextShips = [];

    if (preset === 'all') {
      nextShips = friendlyShips;
    } else if (preset === 'combat') {
      nextShips = friendlyShips.filter((ship) => !ship.className.includes('CARGO'));
    } else if (preset === 'cargos') {
      nextShips = friendlyShips.filter((ship) => ship.className.includes('CARGO'));
    } else if (preset === 'amiraux') {
      nextShips = friendlyShips.filter((ship) => ship.className.includes('AMIRAL'));
    }

    setSelectedShipIds(nextShips.map((ship) => ship.id));

    if (nextShips[0]) {
      setSelected(nextShips[0]);
    }
  };

  const clearTacticalState = () => {
    setSelectedShipIds([]);
    setSelected(null);
    setActionTarget({ x: '', y: '' });
    setActiveCommandPlan(null);
    autoCommandPendingRef.current = false;
    setActionPending('');
    setActionFeedback(null);
    appendLog('Commande auto stoppee.', 'warn');
  };

  const handleShipClick = (ship) => {
    if (suppressClickRef.current || dragMovedRef.current) {
      return;
    }

    if (ship.isEnemy) {
      const planetOnShipCell = planets.find(
        (planet) => planet.x === ship.x && planet.y === ship.y
      );

      if (
        planetOnShipCell &&
        selected?.kind === 'ship' &&
        selected.id === ship.id
      ) {
        setSelected(planetOnShipCell);
        setActionTarget({
          x: String(planetOnShipCell.x),
          y: String(planetOnShipCell.y)
        });
        return;
      }

      setSelected(ship);
      setActionTarget({
        x: String(ship.x),
        y: String(ship.y)
      });
      return;
    }

    const planetOnShipCell = planets.find(
      (planet) => planet.x === ship.x && planet.y === ship.y
    );

    if (
      planetOnShipCell &&
      selected?.kind === 'ship' &&
      selected.id === ship.id
    ) {
      setSelected(planetOnShipCell);
      setActionTarget({
        x: String(planetOnShipCell.x),
        y: String(planetOnShipCell.y)
      });
      return;
    }

    toggleShipSelection(ship);
  };

  const handlePlanetClick = (planet) => {
    if (suppressClickRef.current || dragMovedRef.current) {
      return;
    }

    setSelected(planet);
    setActionTarget({
      x: String(planet.x),
      y: String(planet.y)
    });
  };

  const handleMouseDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (suppressClickTimeoutRef.current) {
      window.clearTimeout(suppressClickTimeoutRef.current);
    }

    suppressClickRef.current = false;
    dragMovedRef.current = false;
    dragPointerRef.current = {
      x: event.clientX,
      y: event.clientY
    };
    setIsDragging(true);
    setDragStart({
      x: event.clientX - viewport.x,
      y: event.clientY - viewport.y
    });
  };

  const handleMouseMove = (event) => {
    if (!isDragging) {
      return;
    }

    const pointerOrigin = dragPointerRef.current;
    if (pointerOrigin) {
      const deltaX = event.clientX - pointerOrigin.x;
      const deltaY = event.clientY - pointerOrigin.y;

      if (Math.hypot(deltaX, deltaY) >= 6) {
        dragMovedRef.current = true;
        suppressClickRef.current = true;
      }
    }

    setViewport({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    if (!isDragging) {
      return;
    }

    setIsDragging(false);
    dragPointerRef.current = null;

    if (!dragMovedRef.current) {
      return;
    }

    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      dragMovedRef.current = false;
    }, 0);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    dragPointerRef.current = null;

    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      dragMovedRef.current = false;
    }, 0);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const zoomAmount = event.deltaY > 0 ? -0.1 : 0.1;
    const nextZoom = Math.min(Math.max(0.3, zoom + zoomAmount), 3);

    if (nextZoom === zoom) {
      return;
    }

    const worldX = (event.clientX - viewport.x) / zoom;
    const worldY = (event.clientY - viewport.y) / zoom;

    setZoom(nextZoom);
    setViewport({
      x: event.clientX - (worldX * nextZoom),
      y: event.clientY - (worldY * nextZoom)
    });
  };

  const executeAction = async (
    action,
    {
      shipIds = selectedShipIds,
      targetX = validTargetX,
      targetY = validTargetY,
      silent = false,
      preserveCommandPlan = false
    } = {}
  ) => {
    if (!shipIds.length) {
      if (!silent) {
        appendLog('Aucune escouade selectionnee.', 'danger');
      }
      return;
    }

    let resolvedTargetX = targetX;
    let resolvedTargetY = targetY;

    if (!Number.isFinite(resolvedTargetX) || !Number.isFinite(resolvedTargetY)) {
      const anchorShip = selectedShips[0] ?? friendlyShips[0] ?? null;
      const selectedOwnedPlanet =
        selected?.kind === 'planet' && selected.owner === team?.nom ? selected : null;
      const fallbackDepositHub =
        selectedOwnedPlanet && hasPlanetModule(selectedOwnedPlanet, 'DECHARGEMENT_RESSOURCE')
          ? selectedOwnedPlanet
          : chooseNearestPlanet(
              anchorShip,
              planets,
              (planet) =>
                planet.owner === team?.nom &&
                hasPlanetModule(planet, 'DECHARGEMENT_RESSOURCE') &&
                !hasPlanetModule(planet, 'GOUVERNANCE_PLANETAIRE')
            );

      if (action === 'FARM_ZONE' || action === 'DEPOSER') {
        if (fallbackDepositHub) {
          resolvedTargetX = fallbackDepositHub.x;
          resolvedTargetY = fallbackDepositHub.y;
          setActionTarget({
            x: String(fallbackDepositHub.x),
            y: String(fallbackDepositHub.y)
          });
        }
      }
    }

    if (!Number.isFinite(resolvedTargetX) || !Number.isFinite(resolvedTargetY)) {
      if (!silent) {
        appendLog('Aucune coordonnee cible definie.', 'danger');
      }
      return;
    }

    try {
      if (silent) {
        autoCommandPendingRef.current = true;
      } else {
        setActionPending(action);
      }
      if (!silent) {
        setActionFeedback(null);
      }

      if (SMART_ACTIONS.has(action) && !preserveCommandPlan) {
        setActiveCommandPlan({
          action,
          shipIds: [...shipIds],
          targetX: resolvedTargetX,
          targetY: resolvedTargetY,
          completedShipIds: []
        });
      }

      const response = await fetch('/api/actions/ships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shipIds,
          action,
          coord_x: resolvedTargetX,
          coord_y: resolvedTargetY
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `Erreur ${response.status}`);
      }

      const completedShipIds = (payload.results ?? [])
        .filter((result) => result.ok && result.completed)
        .map((result) => result.shipId);

      if (SMART_ACTIONS.has(action)) {
        setActiveCommandPlan((previous) => {
          if (!previous || previous.action !== action) {
            return previous;
          }

          const mergedCompletedShipIds = [
            ...new Set([
              ...(previous.completedShipIds ?? []),
              ...completedShipIds
            ])
          ];

          return {
            ...previous,
            completedShipIds: mergedCompletedShipIds
          };
        });
      }

      if (!silent) {
        setActionFeedback(payload);
        appendLog(
          `${formatActionLabel(action)} -> ${payload.summary.success}/${payload.summary.requested} vers [${resolvedTargetX}:${resolvedTargetY}]`,
          payload.summary.failed > 0 ? 'warn' : 'success'
        );
      }
      (payload.results ?? [])
        .filter((result) => !result.ok)
        .slice(0, 3)
        .forEach((result) => {
          if (!silent) {
            appendLog(`${result.shipName}: ${result.error}`, 'warn');
          }
        });
      await fetchData({ mode: 'focus' });
    } catch (error) {
      if (SMART_ACTIONS.has(action) && !preserveCommandPlan) {
        setActiveCommandPlan(null);
      }

      if (!silent) {
        setActionFeedback({
          action,
          summary: {
            requested: shipIds.length,
            success: 0,
            failed: shipIds.length
          },
          results: [],
          error: error.message
        });
        appendLog(`${formatActionLabel(action)} impossible: ${error.message}`, 'danger');
      }
    } finally {
      if (silent) {
        autoCommandPendingRef.current = false;
      } else {
        setActionPending('');
      }
    }
  };

  if (loading) {
    return <div className="loading">CONNECTING TACTICAL GRID...</div>;
  }

  return (
    <div
      className="game-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <div className="scanline" />

      <div
        className="map-canvas"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onWheel={handleWheel}
        onMouseDownCapture={handleMouseDown}
      >
        <div className="map-grid" />

        {hasActionTarget && (
          <div
            className="target-reticle"
            style={{
              left: `${validTargetX * BASE_CELL_SIZE}px`,
              top: `${validTargetY * BASE_CELL_SIZE}px`
            }}
          >
            <div className="target-reticle-core" />
          </div>
        )}

        {renderedPlanets.map((planet) => {
          const style = {
            left: `${planet.x * BASE_CELL_SIZE}px`,
            top: `${planet.y * BASE_CELL_SIZE}px`
          };

          if (!planet.isVisible) {
            return (
              <button
                key={planet.id}
                type="button"
                className={`map-object planet-object interactive-object ghost ${planet.owner ? 'owned-planet' : ''} ${planet.isSelected ? 'selected-target' : ''} ${planet.isCapturable ? 'capturable-planet' : ''} ${planet.badges.some((badge) => ['deposit', 'shipyard'].includes(badge.key)) ? 'strategic-planet' : ''}`}
                style={style}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDragStart={(event) => event.preventDefault()}
                onClick={() => handlePlanetClick(planet)}
              >
                {planet.owner && (
                  <span
                    className="planet-owner-ring ghost"
                    style={{
                      '--planet-owner-color': planet.ownerColor
                    }}
                  />
                )}
                <PlanetImage planet={planet} />
                {planet.owner && (
                  <span
                    className="planet-tag owned-by-team ghost"
                    style={{ '--planet-owner-color': planet.ownerColor }}
                  >
                    {shortShipLabel(planet.displayName)}
                  </span>
                )}
                {planet.badges.length > 0 && (
                  <span className="planet-badge-stack ghost">
                    {planet.badges.slice(0, 2).map((badge) => (
                      <span key={badge.key} className={`planet-badge ${badge.tone}`}>
                        {badge.label}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          }

          return (
            <button
              key={planet.id}
              type="button"
              className={`map-object planet-object interactive-object ${planet.isSelected ? 'selected-target' : ''} ${planet.isOwned ? 'owned-planet' : ''} ${planet.isCapturable ? 'capturable-planet' : ''} ${planet.badges.some((badge) => ['deposit', 'shipyard'].includes(badge.key)) ? 'strategic-planet' : ''}`}
              style={style}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => event.preventDefault()}
              onClick={() => handlePlanetClick(planet)}
            >
              {planet.owner && (
                <span
                  className="planet-owner-ring"
                  style={{
                    '--planet-owner-color': planet.ownerColor
                  }}
                />
              )}
              <PlanetImage planet={planet} />
              {(planet.isOwned || planet.isSelected || planet.isVisible) && (
                <span
                  className={`planet-tag ${planet.isOwned ? 'owned' : 'neutral'} ${planet.owner ? 'owned-by-team' : ''}`}
                  style={planet.owner ? { '--planet-owner-color': planet.ownerColor } : undefined}
                >
                  {shortShipLabel(planet.displayName)}
                </span>
              )}
              {planet.badges.length > 0 && (
                <span className="planet-badge-stack">
                  {planet.badges.slice(0, 2).map((badge) => (
                    <span key={badge.key} className={`planet-badge ${badge.tone}`}>
                      {badge.label}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}

        {renderedShips.map((ship) => {
          const showLabel =
            !ship.isEnemy ||
            ship.isSelected ||
            ship.isSquadMember ||
            ship.className.includes('AMIRAL') ||
            zoom >= 0.9;
          const enemyOwnerLabel = ship.isEnemy
            ? shortShipLabel(ship.owner || 'HOSTILE')
            : '';

          return (
            <button
              key={`${ship.id}-${ship.cellKey}`}
              type="button"
              className={[
                'map-object',
                'ship-object',
                'interactive-object',
                ship.isEnemy ? 'enemy' : 'friendly',
                ship.isSelected ? 'selected-target' : '',
                ship.isSquadMember ? 'squad-member' : ''
              ].join(' ').trim()}
              style={{
                left: `${ship.x * BASE_CELL_SIZE}px`,
                top: `${ship.y * BASE_CELL_SIZE}px`
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => event.preventDefault()}
              onClick={() => handleShipClick(ship)}
            >
              <ShipImage ship={ship} />
              {ship.isEnemy && <span className="enemy-threat-ring" />}
              {ship.isEnemy && (
                <span className="enemy-owner-tag">
                  {enemyOwnerLabel}
                </span>
              )}
              {showLabel && (
                <span className={`ship-tag ${ship.isEnemy ? 'enemy' : 'friendly'}`}>
                  {shortShipLabel(ship.isEnemy ? ship.owner || ship.displayName : ship.displayName)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="hud-panel glass-tech hud-top-left">
        <div className="glitch-text label-tiny">// COMMAND_STATUS</div>
        <div className="panel-title">{team?.nom ?? 'POZCLOPE'} COMMAND</div>

        <div className="stat-grid">
          <div className="stat-card">
            <span>CREDITS</span>
            <strong>{credits}</strong>
          </div>
          <div className="stat-card">
            <span>POINTS</span>
            <strong>{points}</strong>
          </div>
          <div className="stat-card">
            <span>MINERAI</span>
            <strong>{minerai}</strong>
          </div>
          <div className="stat-card">
            <span>FLEET</span>
            <strong>{fleetSlots}/{fleetCapacity || '?'}</strong>
          </div>
        </div>

        <div className="status-strip">
          <span>ALLY SHIPS</span>
          <span className="value-neon">{friendlyShips.length}</span>
        </div>
        <div className="status-strip">
          <span>HOSTILES VISIBLE</span>
          <span className="value-neon danger">{enemyShips.length}</span>
        </div>
        <div className="status-strip">
          <span>SQUAD LOCK</span>
          <span className="value-neon">{selectedShips.length}</span>
        </div>
        <div className="status-strip">
          <span>LIVE SYNC</span>
          <span className="value-neon">{lastSyncLabel}</span>
        </div>
        <div className="status-strip">
          <span>AUTO CMD</span>
          <span className="value-neon">
            {activeCommandPlan
              ? `${formatActionLabel(activeCommandPlan.action)} [${activeCommandPlan.targetX}:${activeCommandPlan.targetY}]`
              : '-'}
          </span>
        </div>

        {fetchError && (
          <div className="status-banner danger">
            {fetchError}
            {teamId === 'demo' ? ' | DEMO MODE ACTIVE' : ''}
          </div>
        )}
      </div>

      <div className="hud-panel glass-tech hud-right-side">
        <div className="glitch-text label-tiny">// LEADERBOARD</div>
        <div className="panel-title">RANK TRACKER</div>
        <div className="scoreboard-list">
          {leaderboard.length === 0 ? (
            <div className="empty-state">NO DATA...</div>
          ) : (
            leaderboard.slice(0, 10).map((entry) => (
              <div
                key={entry.identifiant ?? entry.nom}
                className={`mini-row ${entry.isCurrentTeam ? 'highlighted-row' : ''}`}
              >
                <span className="rank-label">
                  <span>{entry.rang}</span>
                  <span className="truncate">{entry.nom}</span>
                </span>
                <span className="value-neon">{entry.score}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="hud-panel glass-tech hud-bottom-left">
        <div className="glitch-text label-tiny">// TACTICAL_CONSOLE</div>
        <div className="panel-title">TACTICAL CONSOLE</div>

        <div className="button-strip">
          <button type="button" className="tiny-button" onClick={() => selectShipPreset('amiraux')}>Admiraux</button>
          <button type="button" className="tiny-button" onClick={() => selectShipPreset('combat')}>Combat</button>
          <button type="button" className="tiny-button" onClick={() => selectShipPreset('cargos')}>Cargos</button>
          <button type="button" className="tiny-button" onClick={() => selectShipPreset('all')}>Tous</button>
          <button type="button" className="tiny-button ghost" onClick={clearTacticalState}>Clear</button>
        </div>

        <div className="button-strip filter-strip">
          <button type="button" className={`tiny-button ${planetFilter === 'all' ? 'active' : ''}`} onClick={() => setPlanetFilter('all')}>Toutes</button>
          <button type="button" className={`tiny-button ${planetFilter === 'capturable' ? 'active' : ''}`} onClick={() => setPlanetFilter('capturable')}>Capturables</button>
          <button type="button" className={`tiny-button ${planetFilter === 'strategic' ? 'active' : ''}`} onClick={() => setPlanetFilter('strategic')}>Strategiques</button>
          <button type="button" className={`tiny-button ${planetFilter === 'owned' ? 'active' : ''}`} onClick={() => setPlanetFilter('owned')}>A nous</button>
        </div>

        <div className="roster-list">
          {friendlyShips.map((ship) => (
            <button
              key={ship.id}
              type="button"
              className={`roster-row ${selectedShipIds.includes(ship.id) ? 'active' : ''}`}
              onClick={() => toggleShipSelection(ship)}
            >
              <span className="roster-main">
                <span className="roster-name">{ship.displayName}</span>
                <span className="roster-class">{ship.className}</span>
              </span>
              <span className="roster-meta">
                <span>[{ship.x}:{ship.y}]</span>
                <span>{ship.hp} HP</span>
              </span>
            </button>
          ))}
        </div>

        <div className="coord-panel">
          <label>
            X
            <input
              className="coord-input"
              type="number"
              min="0"
              max={FULL_MAP - 1}
              value={actionTarget.x}
              onChange={(event) => setActionTarget((previous) => ({ ...previous, x: event.target.value }))}
            />
          </label>
          <label>
            Y
            <input
              className="coord-input"
              type="number"
              min="0"
              max={FULL_MAP - 1}
              value={actionTarget.y}
              onChange={(event) => setActionTarget((previous) => ({ ...previous, y: event.target.value }))}
            />
          </label>
          <button
            type="button"
            className="tiny-button"
            onClick={() => squadCenter && centerViewport(squadCenter.x, squadCenter.y)}
            disabled={!squadCenter}
          >
            Centrer escouade
          </button>
          <button
            type="button"
            className="tiny-button"
            onClick={() => hasActionTarget && centerViewport(validTargetX, validTargetY)}
            disabled={!hasActionTarget}
          >
            Centrer cible
          </button>
        </div>

        <div className="command-grid">
          {ACTION_BUTTONS.map((button) => (
            <button
              key={button.action}
              type="button"
              className={`command-button ${button.tone}`}
              onClick={() => executeAction(button.action)}
              disabled={Boolean(actionPending)}
            >
              {actionPending === button.action ? '...' : button.label}
            </button>
          ))}
          <button
            type="button"
            className={`command-button accent ${buildPanelOpen ? 'active' : ''}`}
            onClick={handleToggleBuildPanel}
            disabled={Boolean(buildPending)}
          >
            {buildOptionsPending ? '...' : 'Build'}
          </button>
          <button
            type="button"
            className={`command-button accent ${siegePanelOpen ? 'active' : ''}`}
            onClick={handleToggleSiegePanel}
            disabled={Boolean(siegePending)}
          >
            Siege+
          </button>
          <button
            type="button"
            className="command-button neutral"
            onClick={() => fetchData({ mode: 'initial', forceLeaderboard: true })}
          >
            Refresh
          </button>
        </div>

        {buildPanelOpen && (
          <div className="build-panel">
            <div className="mini-row">
              <span>Construction</span>
              <span className="value-neon">{team ? getResourceQuantity(team, 'CREDIT') : 0} CR</span>
            </div>

            {buildOptions.length === 0 ? (
              <div className="empty-state">AUCUN MODELE CONSTRUCTIBLE.</div>
            ) : (
              <>
                <label className="build-field">
                  Modele
                  <select
                    className="build-input"
                    value={buildSelectionKey}
                    onChange={handleBuildSelectionChange}
                    disabled={buildPending}
                  >
                    {buildOptions.map((option) => (
                      <option
                        key={`${option.shipClass}:${option.planetId}`}
                        value={`${option.shipClass}:${option.planetId}`}
                      >
                        {`${formatShipClassLabel(option.shipClass)} · ${option.planetName} · ${option.cost} CR`}
                      </option>
                    ))}
                  </select>
                </label>

                {buildSelection && (
                  <div className="build-option-meta">
                    <span>{buildSelection.planetName}</span>
                    <span>[{buildSelection.planetCoord?.x}:{buildSelection.planetCoord?.y}]</span>
                    <span>{buildSelection.moduleType}</span>
                  </div>
                )}

                <label className="build-field">
                  Nom
                  <input
                    className="build-input"
                    type="text"
                    value={buildShipName}
                    onChange={(event) => setBuildShipName(event.target.value)}
                    placeholder={buildSelection ? suggestShipName(buildSelection) : 'Nom du vaisseau'}
                    disabled={buildPending}
                  />
                </label>

                <div className="build-actions">
                  <button
                    type="button"
                    className="tiny-button ghost"
                    onClick={() => loadBuildOptions()}
                    disabled={buildPending || buildOptionsPending}
                  >
                    Reload
                  </button>
                  <button
                    type="button"
                    className="tiny-button"
                    onClick={handleBuildShip}
                    disabled={!buildSelection || buildPending}
                  >
                    {buildPending ? 'Construction...' : 'Construire'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {siegePanelOpen && (
          <div className="build-panel siege-panel">
            <div className="mini-row">
              <span>Siege++</span>
              <span className={`value-neon ${siegeStatus.running ? '' : 'danger'}`}>
                {siegeStatus.running ? 'RUNNING' : 'IDLE'}
              </span>
            </div>

            <div className="siege-panel-meta">
              <span>Escouade: {selectedShipIds.length || friendlyShips.filter((ship) => !ship.className.includes('CARGO')).length}</span>
              <span>Neutres: {siegeIncludeNeutral ? 'ON' : 'OFF'}</span>
            </div>

            <label className="siege-toggle">
              <input
                type="checkbox"
                checked={siegeIncludeNeutral}
                onChange={(event) => setSiegeIncludeNeutral(event.target.checked)}
                disabled={siegePending || siegeStatus.running}
              />
              Inclure les planetes neutres
            </label>

            {siegeStatus.shipNames?.length > 0 && (
              <div className="build-option-meta">
                {siegeStatus.shipNames.slice(0, 6).map((shipName) => (
                  <span key={shipName}>{shipName}</span>
                ))}
              </div>
            )}

            <div className="build-actions">
              <button
                type="button"
                className="tiny-button ghost"
                onClick={loadSiegeStatus}
                disabled={siegePending}
              >
                Refresh
              </button>
              {siegeStatus.running ? (
                <button
                  type="button"
                  className="tiny-button"
                  onClick={handleStopSiege}
                  disabled={siegePending}
                >
                  {siegePending ? 'Stop...' : 'Stop'}
                </button>
              ) : (
                <button
                  type="button"
                  className="tiny-button"
                  onClick={handleStartSiege}
                  disabled={siegePending}
                >
                  {siegePending ? 'Launch...' : 'Lancer'}
                </button>
              )}
            </div>

            <div className="siege-log">
              {siegeStatus.logs?.length ? (
                siegeStatus.logs.slice(0, 8).map((entry) => (
                  <div key={entry.id} className={`log-entry ${entry.tone}`}>
                    {entry.message}
                  </div>
                ))
              ) : (
                <div className="empty-state">AUCUN LOG SIEGE.</div>
              )}
            </div>
          </div>
        )}

        {actionFeedback && (
          <div className="feedback-box">
            <div className="mini-row">
              <span>{formatActionLabel(actionFeedback.action)}</span>
              <span className="value-neon">
                {actionFeedback.summary?.success ?? 0}/{actionFeedback.summary?.requested ?? 0}
              </span>
            </div>
            {actionFeedback.error && (
              <div className="feedback-row danger">{actionFeedback.error}</div>
            )}
            {(actionFeedback.results ?? []).slice(0, 6).map((result) => (
              <div key={`${result.shipId}-${result.status}`} className={`feedback-row ${result.ok ? 'success' : 'danger'}`}>
                <span>{result.shipName}</span>
                <span>{result.ok ? 'OK' : result.error}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hud-panel glass-tech hud-bottom-right">
        <div className="glitch-text label-tiny">// ACTION_LOG</div>
        <div className="panel-title">BATTLE FEED</div>
        <div className="order-log">
          {orderLog.length === 0 ? (
            <div className="empty-state">AUCUN ORDRE ENCORE.</div>
          ) : (
            orderLog.map((entry) => (
              <div key={entry.id} className={`log-entry ${entry.tone}`}>
                {entry.label}
              </div>
            ))
          )}
        </div>
      </div>

      {selected && (
        <>
          <svg className="connector-svg">
            <path
              d={`M ${(viewport.x + (selected.x * BASE_CELL_SIZE + (BASE_CELL_SIZE / 2)) * zoom)},${(viewport.y + (selected.y * BASE_CELL_SIZE + (BASE_CELL_SIZE / 2)) * zoom)} L ${window.innerWidth - 480},210`}
              className="tech-line"
            />
          </svg>

          <div className="hud-panel glass-tech hud-callout">
            <div className="glitch-text label-tiny">// TARGET_DATA_LINK</div>
            <h3 className="value-neon callout-title">
              {selected.displayName}
            </h3>

            <div className="mini-row">
              <span>CLASS</span>
              <span className="callout-value">
                {selected.kind === 'ship' ? selected.className : selected.category}
              </span>
            </div>
            <div className="mini-row">
              <span>COORD</span>
              <span className="callout-value">[{selected.x}:{selected.y}]</span>
            </div>
            {selected.hp !== undefined && (
              <div className="mini-row">
                <span>INTEGRITY</span>
                <span className="callout-value">{selected.hp}</span>
              </div>
            )}
            {selected.cargo !== undefined && (
              <div className="mini-row">
                <span>CARGO</span>
                <span className="callout-value">{selected.cargo}</span>
              </div>
            )}
            {selected.attack !== undefined && selected.attack > 0 && (
              <div className="mini-row">
                <span>ATK</span>
                <span className="callout-value">{selected.attack}</span>
              </div>
            )}
            {selected.capacity !== undefined && selected.capacity > 0 && (
              <div className="mini-row">
                <span>CAPACITY</span>
                <span className="callout-value">{selected.capacity}</span>
              </div>
            )}
            {selected.minerals !== undefined && (
              <div className="mini-row">
                <span>MINERALS</span>
                <span className="callout-value">{selected.minerals}</span>
              </div>
            )}
            {selected.slots !== undefined && (
              <div className="mini-row">
                <span>SLOTS</span>
                <span className="callout-value">{selected.slots}</span>
              </div>
            )}
            {selected.owner && (
              <div className="mini-row">
                <span>OWNER</span>
                <span className="callout-value">{selected.owner}</span>
              </div>
            )}
            {selected.kind === 'planet' && (
              <div className="callout-badges">
                {getPlanetBadges(selected, team?.nom).map((badge) => (
                  <span key={badge.key} className={`planet-badge ${badge.tone}`}>
                    {badge.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
