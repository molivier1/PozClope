import 'dotenv/config';
import { getEquipes } from './getEquipes.js';
import { getFullMap } from './getFullMap.js';

export async function getAllPlanetes() {
  const equipes = await getEquipes();
  const mapCases = await getFullMap();

  const equipeLookup = Object.fromEntries(
    equipes.map(e => [e.idEquipe, e.nom])
  );

  const planetes = mapCases
    .filter(c =>
      c.planete &&
      c.proprietaire &&
      (
        (typeof c.proprietaire === 'string' && equipeLookup[c.proprietaire]) ||
        (typeof c.proprietaire === 'object' && c.proprietaire.nom)
      )
    )
    .map(c => ({
      idPlanete: c.planete.identifiant,
      nom: c.planete.nom,
      proprietaire:
        typeof c.proprietaire === 'string'
          ? equipeLookup[c.proprietaire]
          : c.proprietaire.nom,
      coord_x: c.coord_x,
      coord_y: c.coord_y,
      type: c.planete.modelePlanete.typePlanete,
      biome: c.planete.modelePlanete.biome,
      minerai: c.planete.mineraiDisponible,
      pointDeVie: c.planete.pointDeVie
    }));

  return planetes;
}