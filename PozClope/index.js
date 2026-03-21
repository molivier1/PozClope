require('dotenv').config();

const API_URL = process.env.API_URL;
const TOKEN = process.env.TOKEN?.trim();
const TEAM_ID = process.env.TEAM_ID;

async function apiGet(path) {
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

async function test() {
  try {
    const ships = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`);
    console.log("Mes vaisseaux :", ships);

    const map = await apiGet(`/monde/map?x_range=0,10&y_range=40,50`);
    console.log("Map :", JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
}

test();