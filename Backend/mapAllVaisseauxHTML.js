// server.js
import express from 'express';
import { getAllVaisseaux } from './getAllVaisseaux.js';
import { getAllPlanetes } from './getAllPlanetes.js';

const app = express();
const PORT = 3000;

// servir le HTML
app.get('/', async (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Carte Dynamique</title>
  <style>
    body { min-height:120vh; padding-bottom:120vh; }
    table { border-collapse: collapse; }
    td { width: 15px; height: 15px; border: 1px solid #ccc; cursor: pointer; }
    td:hover { transform: scale(1.3); position: relative; z-index: 10; }
    .tooltip { position:absolute; background:black; color:white; padding:4px; font-size:12px; display:none; pointer-events:none; }
  </style>
</head>
<body>

<h2>Carte Dynamique des Vaisseaux + Planètes</h2>
<div style="position:relative;">
  <table id="map"></table>
  <div id="tooltip" class="tooltip"></div>
</div>

<script>
window.addEventListener('DOMContentLoaded', () => {
  const couleurs = [
    [230,25,75],[60,180,75],[255,225,25],[67,99,216],[245,130,49],
    [145,30,180],[70,240,240],[240,50,230],[188,246,12],[250,190,190]
  ];

  function lighten(color, amount=0.5){ return 'rgb(' + color.map(c=>Math.min(255,c+(255-c)*amount)).join(',') + ')'; }
  function darken(color, amount=0.5){ return 'rgb(' + color.map(c=>Math.max(0,c*(1-amount))).join(',') + ')'; }

  const table = document.getElementById('map');
  const size = 58;

  // créer la grille
  for(let y=0;y<size;y++){
    const tr=document.createElement('tr');
    for(let x=0;x<size;x++){
      const td=document.createElement('td');
      td.dataset.x=x;
      td.dataset.y=y;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  const tooltip = document.getElementById('tooltip');

  async function updateMap(){
    const [vaisseaux, planetes] = await Promise.all([
      fetch('/api/vaisseaux').then(r=>r.json()),
      fetch('/api/planetes').then(r=>r.json())
    ]);

    const equipes = [...new Set([
      ...vaisseaux.map(v=>v.equipe),
      ...planetes.filter(p=>p.proprietaire).map(p=>p.proprietaire)
    ])];

    const equipeCouleur = {};
    equipes.forEach((e,i)=>equipeCouleur[e] = couleurs[i % couleurs.length]);

    // reset toutes les cases
    for(let y=0;y<size;y++){
      for(let x=0;x<size;x++){
        const td=table.rows[y].cells[x];
        td.style.backgroundColor='';
        td.dataset.type='';
        td.dataset.nom='';
        td.dataset.equipe='';
        td.dataset.pos=x+','+y;
        td.dataset.classe='';
        td.dataset.pv='';
      }
    }

    // planètes
    planetes.forEach(p=>{
      if(!p.proprietaire) return;
      const td=table.rows[p.coord_y]?.cells[p.coord_x];
      if(td){
        td.style.backgroundColor=darken(equipeCouleur[p.proprietaire],0.4);
        td.dataset.type='planete';
        td.dataset.nom=p.nom;
        td.dataset.equipe=p.proprietaire;
      }
    });

    // vaisseaux
    vaisseaux.forEach(v=>{
      const td=table.rows[v.coord_y]?.cells[v.coord_x];
      if(td){
        td.style.backgroundColor=lighten(equipeCouleur[v.equipe],0.4);
        td.dataset.type='vaisseau';
        td.dataset.nom=v.nom;
        td.dataset.equipe=v.equipe;
        td.dataset.classe=v.type;
        td.dataset.pv=v.pointDeVie;
      }
    });
  }

  // tooltip
  table.addEventListener('mousemove', e=>{
    const td=e.target.closest('td');
    if(td && td.dataset.nom){
      tooltip.style.display='block';
      tooltip.style.left=e.pageX+10+'px';
      tooltip.style.top=e.pageY+10+'px';
      if(td.dataset.type==='vaisseau'){
        tooltip.textContent='🚀 '+td.dataset.nom+' | Équipe: '+td.dataset.equipe+' | Pos: '+td.dataset.pos+' | Type: '+td.dataset.classe+' | PV: '+td.dataset.pv;
      } else if(td.dataset.type==='planete'){
        tooltip.textContent='🪐 '+td.dataset.nom+' | Équipe: '+td.dataset.equipe+' | Pos: '+td.dataset.pos;
      }
    } else { tooltip.style.display='none'; }
  });

  // premier update + intervalle 10s
  updateMap();
  setInterval(updateMap,10000);
});
</script>

</body>
</html>
`;
  res.send(html);
});

// API pour les vaisseaux
app.get('/api/vaisseaux', async (req,res)=>{
  const vaisseaux = await getAllVaisseaux();
  res.json(vaisseaux);
});

// API pour les planètes
app.get('/api/planetes', async (req,res)=>{
  const planetes = await getAllPlanetes();
  res.json(planetes);
});

app.listen(PORT, ()=>{
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});