import React, { useState } from 'react';
import './App.css';

const GRID_SIZE = 58;

function App() {
  // MOCK DATA: Replace these with API calls later
  const [credits] = useState(1500);
  const [teamScore] = useState(500);
  const [selectedEntity, setSelectedEntity] = useState(null);

  // Mock positions for your initial 2 ships and base planet [cite: 59]
  const [ships] = useState([
    { id: 's1', x: 10, y: 10, type: 'scout', hp: 100 },
    { id: 's2', x: 11, y: 10, type: 'miner', hp: 100 }
  ]);

  const [planets] = useState([
    { x: 10, y: 11, name: "Home Planet", type: "base", owner: "me" }
  ]);

  const handleCellClick = (x, y) => {
    const ship = ships.find(s => s.x === x && s.y === y);
    const planet = planets.find(p => p.x === x && p.y === y);
    setSelectedEntity(ship || planet || { type: 'empty', x, y });
  };

  const renderGrid = () => {
    let cells = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const ship = ships.find(s => s.x === x && s.y === y);
        const planet = planets.find(p => p.x === x && p.y === y);

        cells.push(
          <div key={`${x}-${y}`} className="cell" onClick={() => handleCellClick(x, y)}>
            {planet && <img src={`/assets/planet_${planet.type}.png`} className="asset-img" />}
            {ship && <img src={`/assets/ship_${ship.type}.png`} className="asset-img" />}
          </div>
        );
      }
    }
    return cells;
  };

  return (
    <div className="game-container">
      {/* SIDEBAR: Ranking and Stats  */}
      <div className="sidebar" style={{ width: '300px', padding: '20px', borderRight: '1px solid #333' }}>
        <h2>Space Conquerors</h2>
        <div className="stats-card">
          <p>Credits: 🪙 {credits}</p>
          <p>Score: ⭐ {teamScore}</p>
        </div>
        <hr />
        {selectedEntity ? (
          <div className="inspector">
            <h3>Inspector</h3>
            <p>Type: {selectedEntity.type}</p>
            <p>Coords: {selectedEntity.x}, {selectedEntity.y}</p>
            {selectedEntity.hp && <p>HP: {selectedEntity.hp}%</p>}
            {/* Action buttons appear here [cite: 88] */}
            <button className="action-btn">MOVE</button>
            <button className="action-btn">RECOLTER</button>
          </div>
        ) : <p>Select a ship or planet</p>}
      </div>

      {/* MAP VIEWPORT  */}
      <div className="map-viewport">
        <div className="grid-layer">
          {renderGrid()}
        </div>
      </div>
    </div>
  );
}

export default App;