import fs from 'fs';
import { getAllVaisseaux } from './getAllVaisseaux.js';
import { getAllPlanetes } from './getAllPlanetes.js';

async function generateHTML() {
  const vaisseaux = await getAllVaisseaux();
  const planetes = await getAllPlanetes();

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Carte</title>
  <style>
    body {
      min-height:120vh;
      padding-bottom: 120vh;
    }
    table { border-collapse: collapse; }
    td {
      width: 15px; height: 15px;
      border: 1px solid #ccc;
      cursor: pointer;
    }
    td:hover { transform: scale(1.3); position: relative; z-index: 10; }
    .tooltip {
      position: absolute;
      background: black;
      color: white;
      padding: 4px;
      font-size: 12px;
      display: none;
      pointer-events: none;
    }
  </style>
</head>
<body>

<h2>Carte Vaisseaux + Planètes</h2>
<div style="position:relative;">
  <table id="map"></table>
  <div id="tooltip" class="tooltip"></div>
</div>

<script>
  const vaisseaux = ${JSON.stringify(vaisseaux)};
  const planetes = ${JSON.stringify(planetes)};

  // Palette RGB (IMPORTANT pour manipuler les couleurs)
  const couleurs = [
    [230,25,75],[60,180,75],[255,225,25],[67,99,216],[245,130,49],
    [145,30,180],[70,240,240],[240,50,230],[188,246,12],[250,190,190]
  ];

  // fonctions couleur
  function lighten(color, amount = 0.5){
    return 'rgb(' + color.map(c => Math.min(255, c + (255 - c)*amount)).join(',') + ')';
  }

  function darken(color, amount = 0.5){
    return 'rgb(' + color.map(c => Math.max(0, c * (1 - amount))).join(',') + ')';
  }

  // équipes uniques
  const equipes = [...new Set([
    ...vaisseaux.map(v => v.equipe),
    ...planetes.map(p => p.proprietaire)
  ])];

  const equipeCouleur = {};
  equipes.forEach((e, i) => {
    equipeCouleur[e] = couleurs[i % couleurs.length];
  });

  const table = document.getElementById('map');
  const size = 58;

  // grille
  for(let y=0; y<size; y++){
    const tr = document.createElement('tr');
    for(let x=0; x<size; x++){
      const td = document.createElement('td');
      td.dataset.x = x;
      td.dataset.y = y;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  // PLANÈTES (couleur foncée)
  planetes.forEach(p => {
    const td = table.rows[p.coord_y]?.cells[p.coord_x];
    if(td){
      td.style.backgroundColor = darken(equipeCouleur[p.proprietaire], 0.4);
      td.dataset.type = 'planete';
      td.dataset.nom = p.nom;
      td.dataset.equipe = p.proprietaire;
      td.dataset.pos = p.coord_x + ',' + p.coord_y;
    }
  });

  // VAISSEAUX (couleur claire)
  vaisseaux.forEach(v => {
    const td = table.rows[v.coord_y]?.cells[v.coord_x];
    if(td){
      td.style.backgroundColor = lighten(equipeCouleur[v.equipe], 0.4);
      td.dataset.type = 'vaisseau';
      td.dataset.nom = v.nom;
      td.dataset.equipe = v.equipe;
      td.dataset.pos = v.coord_x + ',' + v.coord_y;
      td.dataset.classe = v.type;
    }
  });

  // TOOLTIP
  const tooltip = document.getElementById('tooltip');

  table.addEventListener('mousemove', e => {
    const td = e.target.closest('td');

    if(td && td.dataset.nom){
      tooltip.style.display = 'block';
      tooltip.style.left = e.pageX + 10 + 'px';
      tooltip.style.top = e.pageY + 10 + 'px';

      if(td.dataset.type === 'vaisseau'){
        tooltip.textContent =
          '🚀 ' + td.dataset.nom +
          ' | Équipe: ' + td.dataset.equipe +
          ' | Pos: ' + td.dataset.pos +
          ' | Type: ' + td.dataset.classe;
      } else {
        tooltip.textContent =
          '🪐 ' + td.dataset.nom +
          ' | Équipe: ' + td.dataset.equipe +
          ' | Pos: ' + td.dataset.pos;
      }

    } else {
      tooltip.style.display = 'none';
    }
  });
</script>

</body>
</html>
`;

  fs.writeFileSync('mapAllVaisseaux.html', html);
  console.log('Carte générée avec planètes + vaisseaux');
}

generateHTML();