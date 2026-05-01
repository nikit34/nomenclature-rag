import type { Product, Warehouse } from '../ingestion/types.js';
import type { HybridHit } from './hybrid.js';

export type Filters = {
  cities?: Warehouse[];
  requireAvailable?: boolean;
  brand?: string;
  status?: 'Распродажа' | 'Новинка';
  unit?: string;
};

function matchesCity(p: Product, cities: Warehouse[]): boolean {
  if (cities.length === 0) return true;
  return cities.some((c) => {
    const stock = p.stocks[c];
    return stock !== undefined && stock.qty > 0;
  });
}

export function applyFilters(hits: HybridHit[], filters: Filters): HybridHit[] {
  return hits.filter((h) => {
    const p = h.product;
    if (filters.requireAvailable && !p.available) return false;
    if (filters.brand && (!p.vendor.brand || !p.vendor.brand.toLowerCase().includes(filters.brand.toLowerCase()))) {
      return false;
    }
    if (filters.status && p.status !== filters.status) return false;
    if (filters.unit && p.unit !== filters.unit) return false;
    if (filters.cities && filters.cities.length > 0 && !matchesCity(p, filters.cities)) return false;
    return true;
  });
}
