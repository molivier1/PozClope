import 'dotenv/config';
import { get } from './getPath.js';

export async function getEquipes() {
  const listEquipes = [];

  const path = `/equipes`;
  const chunk = await get(path);
  listEquipes.push(...chunk);

  return listEquipes;
}