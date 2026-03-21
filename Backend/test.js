import { getFullMap } from './getFullMap.js';
import { getEquipes } from './getEquipes.js';
import { getAllVaisseaux } from './getAllVaisseaux.js';

async function main() {
  /*
  getMap*/
  try {
    const map = await getFullMap(58, 18);
    console.log("Map complète :", JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
    /**/
   /* 
   getEquipes
   try {
    const equipes = await getEquipes();
    console.log("Équipes :", JSON.stringify(equipes, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }
    */
   /*
   try {
    const vaisseaux = await getAllVaisseaux();
    console.log(JSON.stringify(vaisseaux, null, 2));
  } catch (err) {
    console.error("Erreur :", err.message);
  }*/
}

main();