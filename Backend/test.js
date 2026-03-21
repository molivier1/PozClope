import { getFullMap } from './getFullMap.js';
import { getEquipes } from './getEquipes.js';
import { getAllVaisseaux, getVaisseauxEquipe } from './getAllVaisseaux.js';
import { getAllPlanetes } from './getAllPlanetes.js';
import fs from 'fs'

async function main() {
  /*
  getMap
  try {
    const map = await getFullMap(58, 18);
    //console.log("Map complète :", JSON.stringify(map, null, 2));
    const text = map.map(obj => JSON.stringify(obj, null, 2)).join('\n');

    fs.writeFileSync('mapSnapshot.txt', text, { encoding: 'utf8' });

  } catch (err) {
    console.error("Erreur :", err.message);
  }
    */
   /* 
   getEquipes
   try {
    const equipes = await getEquipes();
    console.log("Équipes :", JSON.stringify(equipes, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
    */
   
   try {
    const planetes = await getAllPlanetes();
    console.log(JSON.stringify(planetes, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
 /*
 try {
    const vaisseaux = await getVaisseauxEquipe("PozClope");
    console.log(JSON.stringify(vaisseaux, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }*/
}

main();