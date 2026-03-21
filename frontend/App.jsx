import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const FULL_MAP = 58; 
const BASE_CELL_SIZE = 50; 

const ShipImage = ({ ship }) => {
  const [errorLevel, setErrorLevel] = useState(0);

  useEffect(() => {
    setErrorLevel(0);
  }, [ship.asset]);

  const capitalAsset = ship.asset.charAt(0).toUpperCase() + ship.asset.slice(1);

  // Super Fallback: Hunts down the most common spelling and capitalization variations
  const sources = [
    `/assets/assets 2d/vaisseaux_2D/${ship.asset}.png`,
    `/assets/assets 2d/vaisseaux_2D/${ship.asset}.svg`,
    `/assets/assets 2d/vaisseaux_2D/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux_2D/${capitalAsset}.svg`,
    `/assets/assets 2d/Vaisseaux_2D/${ship.asset}.png`,
    `/assets/assets 2d/Vaisseaux_2D/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux/${ship.asset}.png`,
    `/assets/assets 2d/vaisseaux/${capitalAsset}.png`,
    `/assets/assets 2d/vaisseaux_2D/explorateur.png`,
    `/assets/assets 2d/vaisseaux_2D/Explorateur.png`
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

function App() {
  const [ships, setShips] = useState([]);
  const [planets, setPlanets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const stateData = await res.json();

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
            category: cell.planete.typePlanete === 'GAZEUSE' ? 'gazeuse' : 'tellurique',
            biome: cell.planete.biome ? cell.planete.biome.toLowerCase() : 'terre'
          })));
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

  // Pixel coordinates for the Fog of War hole
  const holeX = ships[0] ? (ships[0].x * BASE_CELL_SIZE + 25) : 0;
  const holeY = ships[0] ? (ships[0].y * BASE_CELL_SIZE + 25) : 0;

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
              {planet && (
                <img 
                  src={`/assets/assets 2d/planets/${planet.category}/${planet.biome}.svg`} 
                  className="asset-img planet-glow" 
                />
              )}
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
      </div>
    </div>
  );
}

export default App;