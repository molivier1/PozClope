require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const TEAM_ID = process.env.TEAM_ID;
const API_URL = process.env.API_URL;
const TOKEN = process.env.TOKEN;

// This variable will hold the "injected" map data in memory
let cachedMap = [];

/**
 * Fetches the 58x58 map in 18x18 chunks to avoid timeouts.
 * This is the logic from your getMap.js script.
 */
async function fetchFullMap() {
  const chunkSize = 18;
  const size = 58;
  let fullMap = [];

  try {
    for (let y = 0; y < size; y += chunkSize) {
      for (let x = 0; x < size; x += chunkSize) {
        const xEnd = Math.min(x + chunkSize - 1, size - 1);
        const yEnd = Math.min(y + chunkSize - 1, size - 1);
        
        const res = await fetch(`${API_URL}/monde/map?x_range=${x},${xEnd}&y_range=${y},${yEnd}`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        if (res.ok) {
          const chunk = await res.json();
          fullMap.push(...chunk);
        }
      }
    }
    cachedMap = fullMap;
    console.log(`Map data injected: ${cachedMap.length} cells loaded.`);
  } catch (err) {
    console.error("Injection error:", err.message);
  }
}

// Perform initial map injection
fetchFullMap();
// Refresh the static map data every 5 minutes
setInterval(fetchFullMap, 300000);

/**
 * Combined API endpoint for the frontend.
 * Returns live ship positions and the cached map cells.
 */
app.get('/api/state', async (req, res) => {
  try {
    const shipRes = await fetch(`${API_URL}/equipes/${TEAM_ID}/vaisseaux`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    
    if (!shipRes.ok) throw new Error("Could not fetch ships");
    const ships = await shipRes.json();

    res.json({
      ships: ships, 
      cells: cachedMap 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend server active on http://localhost:${PORT}`));