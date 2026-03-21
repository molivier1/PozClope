import 'dotenv/config';
import { getEquipes } from './getEquipes.js';

export async function getAllVaisseaux() {
  const equipes = await getEquipes();

  // On transforme la structure imbriquée en liste plate
  const vaisseaux = equipes.flatMap(equipe => {
    // On parcourt tous les vaisseaux de cette équipe
    return equipe.vaisseaux.map(vaisseau => ({
      ...vaisseau,          // toutes les infos du vaisseau
      equipe: equipe.nom    // ou equipe.id selon ce que tu veux
    }));
  });

  return vaisseaux;
}