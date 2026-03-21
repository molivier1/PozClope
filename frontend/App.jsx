import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const FULL_MAP = 58; 
const BASE_CELL_SIZE = 50; 

function App() {
  // MOCK DATA [cite: 59, 65, 100]
  const [ships] = useState([
    { id: 'Ome-1', x: 25, y: 25, type: 'amiral_1', hp: 92, cargo: 30, captain: 'K. VANCE' },
    { id: 'Min-3', x: 26, y: 25, type: 'chasseur_leger_1', hp: 100, cargo: 10, captain: 'J. DOE' }
  ]);
  const [planets] = useState([
    { x: 25, y: 26, name: "Neptune Alpha", category: "gazeuse", type: "aquatique", owner: "me", temp: '-190C' }
  ]);
  const [leaderboard] = useState([
    { rank: 1, team: "Nexus Collective", score: 8500 },
    { rank: 2, team: "Cyber Vanguard", score: 7200 },
    { rank: 3, team: "Your Team", score: 5400, isYou: true },
    { rank: 4, team: "Ghost Protocol", score: 4800 }
  ]);

  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);
  const [credits] = useState(15000);
  const [score] = useState(5400);

  const hudRef = useRef(null);
  const [lineCoords, setLineCoords] = useState(null);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.min(Math.max(prev + delta, 0.4), 2));
  }, []);

  useEffect(() => {
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const fleetX = (ships[0].x * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);
  const fleetY = (ships[0].y * BASE_CELL_SIZE) + (BASE_CELL_SIZE / 2);

  useEffect(() => {
    const centerX = window.innerWidth / 2 - (fleetX * zoom);
    const centerY = window.innerHeight / 2 - (fleetY * zoom);
    setViewport({ x: centerX, y: centerY });
  }, [ships, fleetX, fleetY, zoom]);

  useEffect(() => {
    if (selected && hudRef.current) {
      const hudRect = hudRef.current.getBoundingClientRect();
      const startX = (selected.x * BASE_CELL_SIZE * zoom) + viewport.x + (BASE_CELL_SIZE * zoom / 2);
      const startY = (selected.y * BASE_CELL_SIZE * zoom) + viewport.y + (BASE_CELL_SIZE * zoom / 2);
      
      setLineCoords({
        x1: startX,
        y1: startY,
        x2: hudRect.left,
        y2: hudRect.top + 30
      });
    } else {
      setLineCoords(null);
    }
  }, [selected, viewport, zoom]);

  return (
    <div className="game-container">
      <div className="scanline" />
      
      <div 
        className="map-canvas" 
        style={{ 
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          '--hole-x': `${fleetX}px`,
          '--hole-y': `${fleetY}px`
        }}
      >
        {[...Array(FULL_MAP * FULL_MAP)].map((_, i) => {
          const x = i % FULL_MAP;
          const y = Math.floor(i / FULL_MAP);
          const ship = ships.find(s => s.x === x && s.y === y);
          const planet = planets.find(p => p.x === x && p.y === y);

          return (
            <div key={i} className="cell" onClick={() => setSelected(ship || planet)}>
              {planet && <img src={`/assets/assets 2d/planets/${planet.category}/${planet.type}.svg`} className="asset-img planet-glow" />}
              {ship && <img src={`/assets/assets 2d/vaisseaux_2D/${ship.type}.png`} className="asset-img" />}
            </div>
          );
        })}
        <div className="fow-overlay" />
      </div>

      {lineCoords && (
        <svg className="connector-svg">
          <path 
            d={`M ${lineCoords.x1} ${lineCoords.y1} L ${lineCoords.x1 + 30} ${lineCoords.y1 - 30} L ${lineCoords.x2} ${lineCoords.y2}`}
            className="tech-line"
          />
          <circle cx={lineCoords.x1} cy={lineCoords.y1} r="4" fill="var(--accent)" className="core-pulse" />
        </svg>
      )}

      {/* TOP LEFT: Vitals  */}
      <div className="hud-panel glass-tech hud-top-left">
        <div className="glitch-text label-tiny">// CORE_LINK_STABLE</div>
        <div className="data-row"><span>CREDITS</span><span className="value-neon">🪙 {credits}</span></div>
        <div className="data-row"><span>RANKING_PTS</span><span className="value-neon">⭐ {score}</span></div>
      </div>

      {/* RIGHT SIDE: Leaderboard & Fleet  */}
      <div className="hud-panel glass-tech hud-right-side">
        <div className="glitch-text label-tiny">// SECTOR_RANKINGS</div>
        <div className="leaderboard-mini">
          {leaderboard.map(t => (
            <div key={t.rank} className={`lb-row ${t.isYou ? 'you' : ''}`}>
              <span>{t.rank}. {t.team}</span>
              <span className="val">{t.score}</span>
            </div>
          ))}
        </div>

        <div className="glitch-text label-tiny" style={{marginTop: '20px'}}>// ACTIVE_UNITS</div>
        <div className="fleet-mini">
          {ships.map(s => (
            <div key={s.id} className="fleet-row">
              <div className="flex-row"><span>{s.id}</span><span>{s.hp}%</span></div>
              <div className="prog-bar-mini"><div className="fill" style={{width: `${s.hp}%`}} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* DYNAMIC CALLOUT HUD [cite: 24, 25, 26, 27] */}
      {selected && (
        <div className="hud-panel glass-tech hud-callout" ref={hudRef}>
          <div className="glitch-text label-tiny" style={{color: '#ffc857'}}>// TARGET_DATA_RESTRICTION_C2</div>
          <h2 className="panel-h2">{selected.name || selected.type.toUpperCase()}</h2>
          <div className="inspector-grid">
            <div className="ins-item"><span className="label">COORDINATES</span><span className="val">[{selected.x}, {selected.y}]</span></div>
            {selected.hp && <div className="ins-item"><span className="label">STRUCTURAL</span><span className="val">{selected.hp}%</span></div>}
            {selected.cargo !== undefined && <div className="ins-item"><span className="label">CARGO_VAL</span><span className="val">{selected.cargo}%</span></div>}
          </div>
          <div className="action-row-tech">
            <button className="cyber-btn-sml">NAVIGATE</button>
            <button className="cyber-btn-sml">EXTRACT</button>
            <button className="cyber-btn-sml">ENGAGE</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;