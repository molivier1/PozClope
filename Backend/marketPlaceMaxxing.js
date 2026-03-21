import 'dotenv/config';
import { get } from './getPath.js';
import fs from 'fs';
import path from 'path';

export async function exportVaisseauxCSV() {
  const listeOffres = await get(`/market/offres`);

  // Préparer les données pour le CSV
  const csvData = listeOffres.map(offre => {
    const vaisseau = offre.plan?.typeVaisseau || {};
    return {
      prix: offre.prix || 0,
      statut: offre.statut || '',
      nom: vaisseau.nom || '',
      attaque: vaisseau.attaque || 0,
      pointsDeVie: vaisseau.pointDeVie || 0,
      vitesse: vaisseau.vitesse || 0,
      capaciteTransport: vaisseau.capaciteTransport || 0,
      coutDeConstruction: vaisseau.coutConstruction || 0,
    };
  });

  // Convertir en CSV
  const headers = Object.keys(csvData[0]).join(';');
  const rows = csvData.map(obj =>
    Object.values(obj)
      .map(value => `"${value}"`) // entourer chaque valeur de guillemets
      .join(';')
  );

  const csvContent = [headers, ...rows].join('\n');

  // Écrire le fichier CSV
  const filePath = path.join(process.cwd(), 'offres_vaisseaux.csv');
  fs.writeFileSync(filePath, csvContent, 'utf-8');

  console.log(`✅ CSV généré : ${filePath}`);
}

// Lancer la fonction
exportVaisseauxCSV();