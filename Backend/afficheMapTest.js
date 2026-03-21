const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'mapSnapshot.txt');
const rawData = fs.readFileSync(filePath, 'utf-8');

// Extraction JSON robuste
function extractJSONObjects(str) {
    const objects = [];
    let depth = 0;
    let start = null;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0 && start !== null) {
                const objStr = str.slice(start, i + 1);
                try { objects.push(JSON.parse(objStr)); } catch(e){}
                start = null;
            }
        }
    }
    return objects;
}

const dataList = extractJSONObjects(rawData);
console.log(`✅ ${dataList.length} planètes chargées.`);

// Palette de couleurs pour les équipes
const colorPalette = [
    '#1E90FF', // bleu
    '#32CD32', // vert
    '#8A2BE2', // violet
    '#FF69B4', // rose
    '#00CED1', // turquoise
    '#4B0082', // indigo
    '#FF1493', // fuchsia
    '#00FA9A', // vert clair
    '#483D8B', // bleu foncé
    '#40E0D0', // cyan
];

// Création du mapping équipe → couleur
const teamColors = {};
let colorIndex = 0;

// Couleurs par biome pour planètes non possédées
const biomeColors = {
    'GLACE': '#ADD8E6',       // bleu clair
    'VOLCANIQUE': '#FF6347',  // rouge/orangé
    'AQUATIQUE': '#1E90FF',   // bleu
    'FORESTIERE': '#228B22',  // vert
    'DESERTIQUE': '#DAA520',  // doré
    'BASIQUE': '#AAAAAA',     // gris
    'VIDE': '#333'            // vide / aucune planète
};

// Normalisation des biomes
function normalizeBiome(b) {
    if (!b) return 'VIDE';
    const normalized = b.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"");
    // Vérifie que le biome est dans notre liste
    return ['GLACE','VOLCANIQUE','AQUATIQUE','FORESTIERE','DESERTIQUE','BASIQUE'].includes(normalized) 
        ? normalized 
        : 'VIDE';
}

const GRID_SIZE = 58;

// Création grille vide
const grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ biome: 'VIDE', owner: null, planetName: null, x: null, y: null }))
);

// Placement des planètes
dataList.forEach(data => {
    const planete = data.planete;
    if (!planete) return;

    const x = Math.max(0, Math.min(GRID_SIZE-1, Math.floor(planete.coord_x)));
    const y = Math.max(0, Math.min(GRID_SIZE-1, Math.floor(planete.coord_y)));

    const biome = normalizeBiome(planete.modelePlanete?.biome);

    // Propriétaire de la planète (au niveau data)
    const owner = (data.proprietaire && data.proprietaire.nom && data.proprietaire.nom.trim() !== '') 
                    ? data.proprietaire.nom
                    : null;

    // Attribuer une couleur à l'équipe si pas déjà fait
    let color = null;
    if (owner) {
        if (!teamColors[owner]) {
            teamColors[owner] = colorPalette[colorIndex % colorPalette.length];
            colorIndex++;
        }
        color = teamColors[owner];
    }

    grid[y][x] = { biome, owner, planetName: planete.nom || null, x: planete.coord_x, y: planete.coord_y, color };
});

// Génération HTML table
let html = `
<html>
<head>
<title>Carte des planètes</title>
<style>
    body { background:#111; color:#eee; font-family:Arial; }
    table { border-collapse: collapse; margin:20px auto; }
    td { width:12px; height:12px; border:1px solid #222; }
    td:hover { outline:2px solid #fff; cursor:pointer; }
</style>
</head>
<body>
<h1 style="text-align:center;">Carte des planètes (${GRID_SIZE}x${GRID_SIZE})</h1>
<table>
`;

for (let y=0; y<GRID_SIZE; y++) {
    html += "<tr>";
    for (let x=0; x<GRID_SIZE; x++) {
        const cell = grid[y][x];

        // Couleur : équipe si possédée, sinon biome
        const color = cell.color || (biomeColors[cell.biome] || biomeColors['VIDE']);

        // Tooltip : nom planète, propriétaire, coordonnées
        let title = `Planète: ${cell.planetName || 'Aucune'}\n`;
        if (cell.owner) title += `Propriétaire: ${cell.owner}\n`;
        if (cell.x !== null && cell.y !== null) title += `Coordonnées: (${cell.x}, ${cell.y})`;

        html += `<td style="background-color:${color}" title="${title}"></td>`;
    }
    html += "</tr>\n";
}

html += "</table></body></html>";

fs.writeFileSync(path.join(__dirname, 'mapSnapshot.html'), html, 'utf-8');
console.log("✅ HTML généré : mapSnapshot.html");
console.log("Couleurs attribuées aux équipes :", teamColors);