import type { Product, Warehouse } from '../ingestion/types.js';
import type { HybridHit } from './hybrid.js';

export type Filters = {
  cities?: Warehouse[];
  requireAvailable?: boolean;
  brands?: string[];
  status?: 'Распродажа' | 'Новинка';
  units?: string[];
};

function matchesCity(p: Product, cities: Warehouse[]): boolean {
  if (cities.length === 0) return true;
  return cities.some((c) => {
    const stock = p.stocks[c];
    return stock !== undefined && stock.qty > 0;
  });
}

function matchesBrands(p: Product, brands: string[]): boolean {
  if (brands.length === 0) return true;
  if (!p.vendor.brand) return false;
  const productBrand = p.vendor.brand.toLowerCase();
  return brands.some((b) => productBrand.includes(b.toLowerCase()));
}

function matchesUnits(p: Product, units: string[]): boolean {
  if (units.length === 0) return true;
  if (!p.unit) return false;
  return units.includes(p.unit);
}

export function applyFilters(hits: HybridHit[], filters: Filters): HybridHit[] {
  return hits.filter((h) => {
    const p = h.product;
    if (filters.requireAvailable && !p.available) return false;
    if (filters.brands && filters.brands.length > 0 && !matchesBrands(p, filters.brands)) {
      return false;
    }
    if (filters.status && p.status !== filters.status) return false;
    if (filters.units && filters.units.length > 0 && !matchesUnits(p, filters.units)) {
      return false;
    }
    if (filters.cities && filters.cities.length > 0 && !matchesCity(p, filters.cities)) return false;
    return true;
  });
}

export function productMatchesFilters(p: Product, filters: Filters): boolean {
  if (filters.requireAvailable && !p.available) return false;
  if (filters.brands && filters.brands.length > 0 && !matchesBrands(p, filters.brands)) return false;
  if (filters.status && p.status !== filters.status) return false;
  if (filters.units && filters.units.length > 0 && !matchesUnits(p, filters.units)) return false;
  if (filters.cities && filters.cities.length > 0 && !matchesCity(p, filters.cities)) return false;
  return true;
}
