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

module.exports = { get };