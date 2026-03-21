import 'dotenv/config';
import { get } from './getPath.js';

export async function getFullMap(size = 58, chunkSize = 18) {
  const fullMap = [];

  for (let yStart = 0; yStart < size; yStart += chunkSize) {
    const yEnd = Math.min(yStart + chunkSize - 1, size - 1);

    for (let xStart = 0; xStart < size; xStart += chunkSize) {
      const xEnd = Math.min(xStart + chunkSize - 1, size - 1);
      const path = `/monde/map?x_range=${xStart},${xEnd}&y_range=${yStart},${yEnd}`;
      console.log(`Récupération de la map : x=${xStart}-${xEnd}, y=${yStart}-${yEnd}`);

      const chunk = await get(path);
      fullMap.push(...chunk); // on ajoute toutes les cases
    }
  }

  return fullMap;
}