import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

const FULL_MAP = 58;
const BASE_CELL_SIZE = 50;
const CLICKABLE_PLANET_SQUARE_SIZE = 18;
const PLANET_RENDER_PADDING = 6;

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
  const fallbacks = Array.from(new Set([
    preferredAsset,
    assetKey,
    'sonde_1',
    'sonde_2'
  ]));

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
        title={ship.id}
      />
    );
  }

  return (
    <img
      src={sources[errorLevel]}
      className={`asset-img ship-img ${ship.isEnemy ? 'enemy' : 'friendly'}`}
      alt={ship.id}
      title={ship.id}
      onError={() => setErrorLevel((prev) => prev + 1)}
    />
  );
};

const PlanetImage = ({ planet }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [planet.id, planet.biome, planet.typePlanete]);

  if (hasError) {
    return <div className={`planet-fallback ${planet.owner ? 'owned' : 'neutral'}`} title={planet.id} />;
  }

  return (
    <img
      src={buildPlanetSource(planet)}
      className={`planet-img ${planet.owner ? 'owned' : 'neutral'}`}
      alt={planet.id}
      title={planet.id}
      onError={() => setHasError(true)}
    />
  );
};

function App() {
  const [ships, setShips] = useState([]);
  const [planets, setPlanets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  const fetchData = async () => {
    try {
      const [stateRes, mapRes, leaderRes] = await Promise.all([
        fetch(`/api/state?x_range=0,${FULL_MAP - 1}&y_range=0,${FULL_MAP - 1}`),
        fetch(`/api/map?x_range=0,${FULL_MAP - 1}&y_range=0,${FULL_MAP - 1}`).catch(() => null),
        fetch('/api/leaderboard').catch(() => null)
      ]);

      if (!stateRes.ok) throw new Error(`API error: ${stateRes.status}`);
      const stateData = await stateRes.json();

      let parsedShips = [];
      if (stateData.ships) {
        parsedShips = stateData.ships.map((s) => ({
          kind: 'ship',
          id: s.nom,
          x: Number(s.coord_x ?? s.x ?? s.positionX),
          y: Number(s.coord_y ?? s.y ?? s.positionY),
          hp: s.pointDeVie,
          asset: s.type?.nom ?? s.type ?? s.modeleVaisseau?.nom ?? 'sonde',
          cargo: s.mineraiTransporte,
          isEnemy: false
        }));
      }

      let mapCells = stateData.cells || [];
      if (mapRes && mapRes.ok) {
        const mapData = await mapRes.json();
        if (mapData.cells) mapCells = mapData.cells;
      }

      const enemyShips = [];
      const parsedPlanets = [];

      mapCells.forEach((cell) => {
        const cellX = Number(cell.coord_x ?? cell.x);
        const cellY = Number(cell.coord_y ?? cell.y);

        if (cell.planete && !cell.planete.estVide) {
          parsedPlanets.push({
            kind: 'planet',
            id: cell.planete.nom ?? cell.planete.identifiant ?? `planet-${cellX}-${cellY}`,
            planetId: cell.planete.identifiant ?? null,
            x: Number(cell.planete.coord_x ?? cellX),
            y: Number(cell.planete.coord_y ?? cellY),
            hp: cell.planete.pointDeVie,
            minerals: cell.planete.mineraiDisponible,
            slots: cell.planete.slotsConstruction,
            biome: cell.planete.biome ?? cell.planete.modelePlanete?.biome,
            typePlanete: cell.planete.typePlanete ?? cell.planete.modelePlanete?.typePlanete,
            owner: cell.proprietaire?.nom || cell.proprietaire?.identifiant || null,
            category: 'PLANET'
          });
        }

        if (cell.vaisseaux && cell.vaisseaux.length > 0) {
          cell.vaisseaux.forEach((s) => {
            if (s.proprietaire && String(s.proprietaire.identifiant) !== String(stateData.teamId)) {
              enemyShips.push({
                kind: 'ship',
                id: s.nom ?? s.name ?? s.identifiant ?? 'Vaisseau Ennemi',
                x: Number(s.coord_x ?? s.x),
                y: Number(s.coord_y ?? s.y),
                hp: s.pointDeVie,
                asset: s.type?.nom ?? s.type ?? s.modeleVaisseau?.nom ?? 'sonde',
                cargo: s.mineraiTransporte,
                isEnemy: true,
                owner: s.proprietaire.nom || s.proprietaire.identifiant || 'Ennemi'
              });
            }
          });
        }
      });

      setShips([...parsedShips, ...enemyShips]);
      setPlanets(parsedPlanets);

      if (leaderRes && leaderRes.ok) {
        const leaderData = await leaderRes.json();
        if (leaderData.leaderboard) {
          setLeaderboard(leaderData.leaderboard);
        }
      }

      setLoading(false);
    } catch (err) {
      console.error('Fetch failed:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  const [hasCentered, setHasCentered] = useState(false);

  useEffect(() => {
    if (hasCentered) return;

    const myShips = ships.filter((s) => !s.isEnemy);
    if (myShips.length === 0) return;

    const target = myShips[0];

    const targetX = (target.x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
    const targetY = (target.y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);

    setViewport({
      x: (window.innerWidth / 2) - (targetX * zoom),
      y: (window.innerHeight / 2) - (targetY * zoom)
    });

    setHasCentered(true);
  }, [ships]);

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

    const updatedPlanet = planets.find((planet) => planet.planetId === selected.planetId || (planet.x === selected.x && planet.y === selected.y));
    if (updatedPlanet) {
      setSelected(updatedPlanet);
    }
  }, [ships, planets, selected]);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setViewport({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleWheel = (e) => {
    const zoomAmount = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prevZoom) => Math.min(Math.max(0.3, prevZoom + zoomAmount), 3));
  };

  const friendlyShips = useMemo(() => ships.filter((ship) => !ship.isEnemy), [ships]);

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

  const renderedPlanets = useMemo(() => {
    const worldLeft = -viewport.x / zoom;
    const worldTop = -viewport.y / zoom;
    const worldRight = worldLeft + (window.innerWidth / zoom);
    const worldBottom = worldTop + (window.innerHeight / zoom);

    const minCellX = Math.max(0, Math.floor(worldLeft / BASE_CELL_SIZE) - PLANET_RENDER_PADDING);
    const maxCellX = Math.min(FULL_MAP - 1, Math.ceil(worldRight / BASE_CELL_SIZE) + PLANET_RENDER_PADDING);
    const minCellY = Math.max(0, Math.floor(worldTop / BASE_CELL_SIZE) - PLANET_RENDER_PADDING);
    const maxCellY = Math.min(FULL_MAP - 1, Math.ceil(worldBottom / BASE_CELL_SIZE) + PLANET_RENDER_PADDING);

    return planets
      .filter((planet) =>
        planet.x >= minCellX &&
        planet.x <= maxCellX &&
        planet.y >= minCellY &&
        planet.y <= maxCellY
      )
      .map((planet) => ({
        ...planet,
        cellKey: `${planet.x},${planet.y}`,
        isVisible: visiblePlanetCells.has(`${planet.x},${planet.y}`)
      }));
  }, [planets, visiblePlanetCells, viewport.x, viewport.y, zoom]);

  const renderedShips = useMemo(
    () => ships.map((ship) => ({ ...ship, cellKey: `${ship.x},${ship.y}` })),
    [ships]
  );

  if (loading) return <div className="loading">CONNECTING...</div>;

  return (
    <div className="game-container" onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
      <div
        className="map-canvas"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      >
        <div className="map-grid" />
        {renderedPlanets.map((planet) => {
          const style = {
            left: `${planet.x * BASE_CELL_SIZE}px`,
            top: `${planet.y * BASE_CELL_SIZE}px`
          };

          if (!planet.isVisible) {
            return (
              <div key={planet.planetId ?? planet.cellKey} className="map-object planet-object ghost" style={style}>
                <PlanetImage planet={planet} />
              </div>
            );
          }

          return (
            <button
              key={planet.planetId ?? planet.cellKey}
              type="button"
              className="map-object planet-object interactive-object"
              style={style}
              onClick={() => setSelected(planet)}
            >
              <PlanetImage planet={planet} />
            </button>
          );
        })}
        {renderedShips.map((ship) => (
          <button
            key={`${ship.id}-${ship.cellKey}`}
            type="button"
            className="map-object ship-object interactive-object"
            style={{
              left: `${ship.x * BASE_CELL_SIZE}px`,
              top: `${ship.y * BASE_CELL_SIZE}px`
            }}
            onClick={() => setSelected(ship)}
          >
            <ShipImage ship={ship} />
          </button>
        ))}
      </div>

      <div className="hud-panel glass-tech hud-top-left">
        <div className="glitch-text label-tiny">// LIVE_DATA_LINK</div>
        <div className="flex-between"><span>SHIPS ACTIVE</span><span className="value-neon">{ships.filter((s) => !s.isEnemy).length}</span></div>

        {ships.filter((s) => !s.isEnemy).length > 0 && (
          <div className="flex-col" style={{ marginTop: '15px', gap: '6px', maxHeight: '35vh', overflowY: 'auto', paddingRight: '4px' }}>
            <div className="glitch-text label-tiny">// FLEET_ROSTER</div>
            {ships.filter((s) => !s.isEnemy).map((ship, idx) => {
              return (
                <div key={idx} className="mini-row flex-col" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setSelected(ship)}>
                  <div className="flex-between w-full">
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{ship.id}</span>
                    <span className="value-neon" style={{ fontSize: '10px' }}>[{ship.x}:{ship.y}]</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="hud-panel glass-tech hud-right-side">
        <div className="glitch-text label-tiny">// LEADERBOARD_LINK</div>
        <div className="flex-col" style={{ gap: '2px', marginTop: '8px' }}>
          {leaderboard.length === 0 ? (
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>NO DATA...</div>
          ) : (
            leaderboard.slice(0, 10).map((team, idx) => (
              <div key={idx} className="mini-row" style={{ backgroundColor: team.isCurrentTeam ? 'rgba(255, 0, 255, 0.2)' : 'rgba(255, 0, 255, 0.05)' }}>
                <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ opacity: 0.7, width: '15px' }}>{team.rang}</span>
                  <span style={{ color: team.isCurrentTeam ? '#fff' : 'inherit', fontWeight: team.isCurrentTeam ? 'bold' : 'normal', display: 'inline-block', maxWidth: '130px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {team.nom}
                  </span>
                </span>
                <span className="value-neon" style={{ fontSize: '11px' }}>{team.score}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {selected && (
        <>
          <svg className="connector-svg">
            <path
              d={`M ${(viewport.x + (selected.x * BASE_CELL_SIZE + (BASE_CELL_SIZE / 2)) * zoom)},${(viewport.y + (selected.y * BASE_CELL_SIZE + (BASE_CELL_SIZE / 2)) * zoom)} L ${window.innerWidth - 580},170`}
              className="tech-line"
            />
          </svg>

          <div className="hud-panel glass-tech hud-callout">
            <div className="glitch-text label-tiny">// TARGET_DATA_LINK</div>
            <h3 className="value-neon" style={{ margin: '5px 0', textTransform: 'uppercase' }}>
              {selected.id || selected.name}
            </h3>

            <div className="flex-col">
              <div className="mini-row">
                <span>TYPE</span>
                <span style={{ color: '#fff', textTransform: 'uppercase' }}>{selected.asset || selected.biome || 'UNKNOWN'}</span>
              </div>

              <div className="mini-progress"><div className="fill" style={{ width: '100%' }}></div></div>

              <div className="mini-row" style={{ marginTop: '8px' }}>
                <span>COORDINATES</span>
                <span style={{ color: '#fff' }}>[{selected.x} : {selected.y}]</span>
              </div>

              {selected.hp !== undefined && (
                <div className="mini-row">
                  <span>INTEGRITY</span>
                  <span style={{ color: '#fff' }}>{selected.hp}</span>
                </div>
              )}

              {selected.cargo !== undefined && (
                <div className="mini-row">
                  <span>CARGO</span>
                  <span style={{ color: '#fff' }}>{selected.cargo}</span>
                </div>
              )}

              {selected.minerals !== undefined && (
                <div className="mini-row">
                  <span>MINERALS</span>
                  <span style={{ color: '#fff' }}>{selected.minerals}</span>
                </div>
              )}

              {selected.slots !== undefined && (
                <div className="mini-row">
                  <span>SLOTS</span>
                  <span style={{ color: '#fff' }}>{selected.slots}</span>
                </div>
              )}

              {selected.owner && (
                <div className="mini-row">
                  <span>OWNER</span>
                  <span style={{ color: '#fff', textTransform: 'uppercase' }}>{selected.owner}</span>
                </div>
              )}

              {selected.category && (
                <div className="mini-row">
                  <span>CLASS</span>
                  <span style={{ color: '#fff', textTransform: 'uppercase' }}>{selected.category}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
