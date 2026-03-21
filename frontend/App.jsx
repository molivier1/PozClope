import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const FULL_MAP = 58; 
const BASE_CELL_SIZE = 50; 

const ShipImage = ({ ship }) => {
  const [errorLevel, setErrorLevel] = useState(0);

  useEffect(() => {
    setErrorLevel(0);
  }, [ship.asset]);

  // Handle names with spaces (e.g. "vaisseau cargo" -> "vaisseau_cargo")
  const safeAsset = ship.asset.replace(/\s+/g, '_');
  const capitalAsset = safeAsset.charAt(0).toUpperCase() + safeAsset.slice(1);

  // Super Fallback: Hunts down the most common spelling and capitalization variations
  const sources = [
    `/assets/assets 2d/vaisseaux_2D/${safeAsset}.png`,
    `/assets/assets 2d/vaisseaux_2D/${safeAsset}.svg`,
    `/assets/assets 2d/vaisseaux_2D/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux_2D/${capitalAsset}.svg`,
    `/assets/assets 2d/vaisseaux 2d/${safeAsset}.png`,
    `/assets/assets 2d/vaisseaux 2d/${safeAsset}.svg`,
    `/assets/assets 2d/Vaisseaux_2D/${safeAsset}.png`,
    `/assets/assets 2d/Vaisseaux_2D/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux/${safeAsset}.png`,
    `/assets/assets 2d/vaisseaux/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux_2D/explorateur.png`,
    `/assets/assets 2d/vaisseaux_2D/explorateur.svg`,
    `/assets/assets 2d/vaisseaux_2D/Explorateur.png`,
    `/assets/assets 2d/vaisseaux_2D/Explorateur.svg`
  ];

  if (errorLevel >= sources.length) {
    return (
      <div 
        style={{ width: '20px', height: '20px', backgroundColor: 'var(--accent)', borderRadius: '50%', boxShadow: '0 0 10px var(--accent)', position: 'absolute', zIndex: 20 }} 
        title={ship.id}
      />
    );
  }

  return (
    <img
      src={sources[errorLevel]}
      className="asset-img"
      style={{ width: '60%', position: 'absolute', zIndex: 20 }}
      alt={ship.id}
      onError={() => setErrorLevel(prev => prev + 1)}
    />
  );
};

const PlanetImage = ({ planet }) => {
  const [errorLevel, setErrorLevel] = useState(0);

  useEffect(() => {
    setErrorLevel(0);
  }, [planet.category, planet.biome]);

  const safeBiome = planet.biome ? planet.biome.replace(/\s+/g, '_') : 'terre';
  const capitalBiome = safeBiome.charAt(0).toUpperCase() + safeBiome.slice(1);
  const category = planet.category || 'tellurique';
  const capitalCategory = category.charAt(0).toUpperCase() + category.slice(1);

  const sources = [
    `/assets/assets 2d/planets/${category}/${safeBiome}.svg`,
    `/assets/assets 2d/planets/${category}/${safeBiome}.png`,
    `/assets/assets 2d/planets/${capitalCategory}/${capitalBiome}.svg`,
    `/assets/assets 2d/planets/${capitalCategory}/${capitalBiome}.png`,
    `/assets/assets 2d/planets/${safeBiome}.svg`,
    `/assets/assets 2d/planets/${safeBiome}.png`
  ];

  if (errorLevel >= sources.length) {
    return (
      <div
        style={{ width: '30px', height: '30px', backgroundColor: category === 'gazeuse' ? '#a342f5' : '#42f5aa', borderRadius: '50%', boxShadow: '0 0 10px currentColor', position: 'absolute', zIndex: 15 }}
        title={planet.name}
      />
    );
  }

  return (
    <img
      src={sources[errorLevel]}
      className="asset-img planet-glow"
      style={{ width: '80%', position: 'absolute', zIndex: 15 }}
      alt={planet.name}
      onError={() => setErrorLevel(prev => prev + 1)}
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
      const [stateRes, leaderRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/leaderboard').catch(() => null) // Fail silently if leaderboard is unavailable
      ]);
      
      if (!stateRes.ok) throw new Error(`API error: ${stateRes.status}`);
      const stateData = await stateRes.json();

      // 1. Correct Ship Mapping (matches your console output)
      if (stateData.ships) {
        setShips(stateData.ships.map(s => ({
          id: s.nom,
          x: s.coord_x,
          y: s.coord_y,
          hp: s.pointDeVie,
          asset: s.type ? String(s.type).toLowerCase() : 'explorateur',
          cargo: s.mineraiTransporte
        })));
      }

      // 2. Correct Planet Mapping (matches getMap.js JSON)
      if (stateData.cells) {
        setPlanets(stateData.cells
          .filter(cell => cell.planete && !cell.planete.estVide)
          .map(cell => ({
            x: cell.coord_x,
            y: cell.coord_y,
            name: cell.planete.nom,
            category: (cell.planete.typePlanete || cell.planete.modelePlanete?.typePlanete) === 'GAZEUSE' ? 'gazeuse' : 'tellurique',
            biome: (cell.planete.biome || cell.planete.modelePlanete?.biome || 'terre').toLowerCase(),
            hp: cell.planete.pointDeVie,
            minerals: cell.planete.mineraiDisponible,
            owner: cell.proprietaire ? cell.proprietaire.nom : 'UNCLAIMED',
            slots: cell.planete.slotsConstruction
          })));
      }

      // 3. Leaderboard Mapping
      if (leaderRes && leaderRes.ok) {
        const leaderData = await leaderRes.json();
        if (leaderData.leaderboard) {
          setLeaderboard(leaderData.leaderboard);
        }
      }

      setLoading(false);
    } catch (err) {
      console.error("Fetch failed:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000); 
    return () => clearInterval(interval);
  }, []);

  // Center viewport on the first ship
  useEffect(() => {
    if (ships.length > 0) {
      const activeShip = ships[0];
      const fleetX = (activeShip.x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
      const fleetY = (activeShip.y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
      
      setViewport({ 
        x: (window.innerWidth / 2) - (fleetX * zoom), 
        y: (window.innerHeight / 2) - (fleetY * zoom) 
      });
    }
  }, [ships[0]?.x, ships[0]?.y, zoom]); // Reacts when the active ship moves

  // Keep selected item updated when data changes (e.g., ship moves, takes damage)
  useEffect(() => {
    if (selected) {
      const updatedShip = ships.find(s => s.id === selected.id);
      if (updatedShip) {
        setSelected(updatedShip);
      } else {
        const updatedPlanet = planets.find(p => p.name === selected.name);
        if (updatedPlanet) setSelected(updatedPlanet);
      }
    }
  }, [ships, planets]);

  // Pixel coordinates for the Fog of War hole
  const holeX = ships[0] ? (ships[0].x * BASE_CELL_SIZE + 25) : (FULL_MAP * BASE_CELL_SIZE / 2);
  const holeY = ships[0] ? (ships[0].y * BASE_CELL_SIZE + 25) : (FULL_MAP * BASE_CELL_SIZE / 2);

  if (loading) return <div className="loading">CONNECTING...</div>;

  return (
    <div className="game-container">
      <div 
        className="map-canvas" 
        style={{ 
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          '--hole-x': `${holeX}px`,
          '--hole-y': `${holeY}px`
        }}
      >
        {[...Array(FULL_MAP * FULL_MAP)].map((_, i) => {
          const x = i % FULL_MAP;
          const y = Math.floor(i / FULL_MAP);
          const ship = ships.find(s => s.x === x && s.y === y);
          const planet = planets.find(p => p.x === x && p.y === y);

          return (
            <div key={i} className="cell" onClick={() => setSelected(ship || planet)}>
              {planet && <PlanetImage planet={planet} />}
              {ship && <ShipImage ship={ship} />}
            </div>
          );
        })}
        {/* Fog layer is inside the canvas so it scales with everything */}
        <div className="fow-overlay" />
      </div>

      <div className="hud-panel glass-tech hud-top-left">
        <div className="glitch-text label-tiny">// LIVE_DATA_LINK</div>
        <div className="flex-between"><span>SHIPS ACTIVE</span><span className="value-neon">{ships.length}</span></div>

        {ships.length > 0 && (
          <div className="flex-col" style={{ marginTop: '15px', gap: '6px', maxHeight: '50vh', overflowY: 'auto', paddingRight: '4px' }}>
            <div className="glitch-text label-tiny">// FLEET_ROSTER</div>
            {ships.map((ship, idx) => {
              const planetOn = planets.find(p => p.x === ship.x && p.y === ship.y);
              return (
                <div key={idx} className="mini-row flex-col" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setSelected(ship)}>
                  <div className="flex-between w-full">
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{ship.id}</span>
                    <span className="value-neon" style={{ fontSize: '10px' }}>[{ship.x}:{ship.y}]</span>
                  </div>
                  {planetOn && (
                    <span style={{ fontSize: '9px', color: 'var(--accent)', marginTop: '2px', textTransform: 'uppercase' }}>
                      ⮡ ON {planetOn.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LEADERBOARD HUD */}
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

      {/* TARGET HUD & CONNECTING LINE */}
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