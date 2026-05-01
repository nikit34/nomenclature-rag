import { WAREHOUSES, type Warehouse } from '../ingestion/types.js';

type CityRule = { stem: string; warehouses: Warehouse[] };

export const CITY_RULES: CityRule[] = [
  { stem: 'москв', warehouses: ['Москва, Кантемировская', 'Королёв', 'МО, Клин'] },
  { stem: 'мск', warehouses: ['Москва, Кантемировская', 'Королёв', 'МО, Клин'] },
  { stem: 'санкт-петербург', warehouses: ['Санкт-Петербург'] },
  { stem: 'санкт петербург', warehouses: ['Санкт-Петербург'] },
  { stem: 'петербург', warehouses: ['Санкт-Петербург'] },
  { stem: 'спб', warehouses: ['Санкт-Петербург'] },
  { stem: 'питер', warehouses: ['Санкт-Петербург'] },
  { stem: 'воронеж', warehouses: ['Воронеж'] },
  { stem: 'краснодар', warehouses: ['Краснодар'] },
  { stem: 'казан', warehouses: ['Казань'] },
  { stem: 'королёв', warehouses: ['Королёв'] },
  { stem: 'королев', warehouses: ['Королёв'] },
  { stem: 'клин', warehouses: ['МО, Клин'] },
];

const STOP_WORDS = new Set([
  'и', 'в', 'на', 'или', 'для', 'с', 'у', 'не', 'это', 'есть', 'наличие',
  'товар', 'товары', 'того', 'это', 'тоже', 'также',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

function isValidCaseEnding(suffix: string): boolean {
  if (suffix.length === 0) return true;
  if (suffix.length > 3) return false;
  return /^[аяуюеёиыоэйь]+$/u.test(suffix);
}

export function detectCities(query: string): Warehouse[] {
  const tokens = tokenize(query);
  const matched = new Set<Warehouse>();
  for (const rule of CITY_RULES) {
    const stem = rule.stem.toLowerCase();
    const stemHasSpace = stem.includes(' ');
    if (stemHasSpace) {
      if (query.toLowerCase().includes(stem)) for (const w of rule.warehouses) matched.add(w);
      continue;
    }
    for (const t of tokens) {
      if (!t.startsWith(stem)) continue;
      const suffix = t.slice(stem.length);
      if (!isValidCaseEnding(suffix)) continue;
      for (const w of rule.warehouses) matched.add(w);
      break;
    }
  }
  return Array.from(matched);
}

export const ALL_WAREHOUSES = WAREHOUSES;
