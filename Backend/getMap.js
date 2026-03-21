require('dotenv').config();

const API_URL = process.env.API_URL;
const TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;

async function get(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur ${res.status} : ${text}`);
  }

  return res.json();
}

async function getFullMap(size = 58, chunkSize = 18) {
  const fullMap = [];

  for (let yStart = 0; yStart < size; yStart += chunkSize) {
    const yEnd = Math.min(yStart + chunkSize - 1, size - 1);

    for (let xStart = 0; xStart < size; xStart += chunkSize) {
      const xEnd = Math.min(xStart + chunkSize - 1, size - 1);
      const path = `/monde/map?x_range=${xStart},${xEnd}&y_range=${yStart},${yEnd}`;
      console.log(`Récupération de la map : x=${xStart}-${xEnd}, y=${yStart}-${yEnd}`);

      const chunk = await get(path);
      fullMap.push(...chunk); // on ajoute toutes les cases
    }
  }

  return fullMap;
}

async function main() {
  try {
    const map = await getFullMap(58, 18);
    console.log("Map complète :", JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
}

main();