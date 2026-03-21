import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const FULL_MAP = 58; 
const BASE_CELL_SIZE = 50; 

function App() {
  const [ships, setShips] = useState([]);
  const [planets, setPlanets] = useState([]);
  const [credits, setCredits] = useState(15000);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);

  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);

  const hudRef = useRef(null);
  const [lineCoords, setLineCoords] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const stateData = await res.json();

      if (stateData.ships) {
        const liveShips = stateData.ships.map(s => ({
          id: s.nom,
          x: s.coord_x,
          y: s.coord_y,
          hp: s.pointDeVie,
          type: s.type,
          cargo: s.mineraiTransporte
        }));
        setShips(liveShips);
      }

      if (stateData.cells) {
        const planetsData = stateData.cells
          .filter(cell => cell.planete)
          .map(cell => ({
            x: cell.x,
            y: cell.y,
            name: cell.planete.nom,
            type: cell.planete.typePlanete?.toLowerCase() || 'terre',
            category: cell.planete.typePlanete === 'GAZEUSE' ? 'gazeuse' : 'tellurique'
          }));
        setPlanets(planetsData);
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

  // Updated centering logic to ensure the ship (and the fog hole) is visible
  useEffect(() => {
    if (ships.length > 0) {
      const activeShip = ships[0];
      const fleetX = (activeShip.x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
      const fleetY = (activeShip.y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
      
      const centerX = (window.innerWidth / 2) - (fleetX * zoom);
      const centerY = (window.innerHeight / 2) - (fleetY * zoom);
      
      setViewport({ x: centerX, y: centerY });
    }
  }, [ships.length, zoom]);

  useEffect(() => {
    if (selected && hudRef.current) {
      const hudRect = hudRef.current.getBoundingClientRect();
      const startX = (selected.x * BASE_CELL_SIZE * zoom) + viewport.x + (BASE_CELL_SIZE * zoom / 2);
      const startY = (selected.y * BASE_CELL_SIZE * zoom) + viewport.y + (BASE_CELL_SIZE * zoom / 2);
      setLineCoords({ x1: startX, y1: startY, x2: hudRect.left, y2: hudRect.top + 30 });
    } else {
      setLineCoords(null);
    }
  }, [selected, viewport, zoom]);

  const handleWheel = useCallback((e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(prev + delta, 0.4), 2));
    }
  }, []);

  useEffect(() => {
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Coordinates for the radial-gradient mask (Fog of War)
  const holeX = ships[0] ? (ships[0].x * BASE_CELL_SIZE + 25) : (FULL_MAP * BASE_CELL_SIZE) / 2;
  const holeY = ships[0] ? (ships[0].y * BASE_CELL_SIZE + 25) : (FULL_MAP * BASE_CELL_SIZE) / 2;

  if (loading) return <div className="loading">INITIALIZING NEURAL LINK...</div>;

  return (
    <div className="game-container">
      <div className="scanline" />
      
      <div 
        className="map-canvas" 
        style={{ 
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          '--hole-x': `${holeX}px`,
          '--hole-y': `${holeY}px`
        }}
      >
        {/* Render the Grid */}
        {[...Array(FULL_MAP * FULL_MAP)].map((_, i) => {
          const x = i % FULL_MAP;
          const y = Math.floor(i / FULL_MAP);
          const ship = ships.find(s => s.x === x && s.y === y);
          const planet = planets.find(p => p.x === x && p.y === y);

          return (
            <div key={i} className="cell" onClick={() => setSelected(ship || planet)}>
              {planet && <img src={`/assets/assets 2d/planets/${planet.category}/${planet.type}.svg`} alt={planet.name} className="asset-img planet-glow" />}
              {ship && <img src={`/assets/assets 2d/vaisseaux_2D/${ship.type}.png`} alt={ship.id} className="asset-img" />}
            </div>
          );
        })}
        {/* The Mask Layer is inside the map-canvas so it moves and scales with the grid */}
        <div className="fow-overlay" />
      </div>

      {lineCoords && (
        <svg className="connector-svg">
          <path d={`M ${lineCoords.x1} ${lineCoords.y1} L ${lineCoords.x1 + 30} ${lineCoords.y1 - 30} L ${lineCoords.x2} ${lineCoords.y2}`} className="tech-line" />
          <circle cx={lineCoords.x1} cy={lineCoords.y1} r="4" fill="var(--accent)" className="core-pulse" />
        </svg>
      )}

      {/* HUD ELEMENTS */}
      <div className="hud-panel glass-tech hud-top-left">
        <div className="glitch-text label-tiny">// LIVE_DATA_LINK</div>
        <div className="flex-between"><span>CREDITS</span><span className="value-neon">{credits}</span></div>
        <div className="flex-between"><span>SCORE</span><span className="value-neon">{score}</span></div>
      </div>

      <div className="hud-panel glass-tech hud-right-side">
        <div className="glitch-text label-tiny">// ACTIVE_UNITS</div>
        <div className="mini-list">
          {ships.map(s => (
            <div key={s.id} className="mini-row">
              <div className="flex-col w-full">
                <div className="flex-between"><span>{s.id}</span><span>{s.hp}%</span></div>
                <div className="mini-progress"><div className="fill" style={{width: `${s.hp}%`}} /></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="hud-panel glass-tech hud-callout" ref={hudRef}>
          <div className="glitch-text label-tiny">// TARGET_LOCKED</div>
          <h2 style={{ margin: '5px 0', fontSize: '18px' }}>{selected.name || selected.id}</h2>
          <div className="flex-col">
            <div className="flex-between"><span className="label-tiny">LOC</span><span className="value-neon">[{selected.x}, {selected.y}]</span></div>
            <div className="flex-between"><span className="label-tiny">STATUS</span><span className="value-neon">{selected.hp || 100}%</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;