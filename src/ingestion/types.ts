export type Stock = {
  qty: number;
  approx: boolean;
};

export type Vendor = {
  raw: string;
  brand?: string;
  country?: string;
};

export type NumericAttrs = {
  length_mm?: number;
  diameter_mm?: number;
  thickness_mm?: number;
  width_mm?: number;
  height_mm?: number;
  threadM?: number;
  centerDistance_mm?: number;
  load_kg?: number;
};

export type Prices = {
  retail: number;
  wholesale?: number;
  legalEntityBYN?: number;
  individualBYN?: number;
  usd?: number;
};

export type Product = {
  offerId: number;
  name: string;
  vendor: Vendor;
  model: string;
  vendorCode: string;
  vendorCodeNorm: string;
  description: string;
  attrs: Record<string, string>;
  numericAttrs: NumericAttrs;
  categoryId: number;
  unit: string | null;
  prices: Prices;
  hitSales?: number;
  warrantyManufacturer: boolean;
  status?: 'Распродажа' | 'Новинка';
  available: boolean;
  stocks: Record<string, Stock>;
  searchText: string;
};

export const WAREHOUSES = [
  'Москва, Кантемировская',
  'Санкт-Петербург',
  'Воронеж',
  'Королёв',
  'Краснодар',
  'Казань',
  'МО, Клин',
] as const;

export type Warehouse = (typeof WAREHOUSES)[number];
