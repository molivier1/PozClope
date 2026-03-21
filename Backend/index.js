require('dotenv').config();

const AUTH_URL = process.env.AUTH_URL;
const API_URL = process.env.API_URL;
const TEAM_ID = process.env.TEAM_ID;

// Configuration from your .env 
const authConfig = {
  realm: process.env.KEYCLOAK_REALM,
  client_id: process.env.KEYCLOAK_CLIENT_ID,
  username: process.env.KEYCLOAK_USERNAME,
  password: process.env.KEYCLOAK_PASSWORD,
  grant_type: 'password'
};

async function getFreshToken() {
  const url = `${AUTH_URL}/realms/${authConfig.realm}/protocol/openid-connect/token`; // [cite: 7]
  
  const params = new URLSearchParams();
  params.append('client_id', authConfig.client_id); // [cite: 9]
  params.append('username', authConfig.username); // [cite: 10]
  params.append('password', authConfig.password); // 
  params.append('grant_type', 'password'); // [cite: 12]

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // [cite: 8]
    body: params
  });

  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  
  const data = await res.json();
  return data.access_token; // 
}

async function apiGet(path, token) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`, // [cite: 5, 6]
      'Accept': "application/json"
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
    console.log("Fetching fresh token...");
    const token = await getFreshToken();
    
    // Now use the fresh token for your requests [cite: 4]
    const ships = await apiGet(`/equipes/${TEAM_ID}/vaisseaux`, token);
    console.log("Mes vaisseaux :", ships);

    const map = await apiGet(`/monde/map?x_range=0,10&y_range=40,50`, token);
    console.log("Map sample loaded.");
  } catch (err) {
    console.error("Erreur :", err.message);
  }
}

test();