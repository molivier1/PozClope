import 'dotenv/config';
import { getEquipes } from './getEquipes.js';
import { getFullMap } from './getFullMap.js'; // ta fonction existante

export async function getAllVaisseaux() {
  const equipes = await getEquipes();
  const mapCases = await getFullMap(); // toutes les cases avec vaisseaux, modules, planètes

  // Lookup rapide des équipes
  const equipeLookup = Object.fromEntries(equipes.map(e => [e.idEquipe, e.nom]));

  // Parcours des cases pour extraire les vaisseaux
  const vaisseaux = mapCases
    .filter(c => c.vaisseau) // garder uniquement les cases avec vaisseau
    .map(c => ({
      idVaisseau: c.vaisseau.idVaisseau,
      nom: c.vaisseau.nom,
      equipe: equipeLookup[c.vaisseau.proprietaire] || 'Inconnu',
      coord_x: c.coord_x,
      coord_y: c.coord_y,
      pointDeVie: c.vaisseau.pointDeVie,
      type: c.vaisseau.type.nom
    }));

  return vaisseaux;
}