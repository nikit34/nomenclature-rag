import { describe, expect, it } from 'vitest';
import { detectCities } from './cityAliases.js';

describe('detectCities', () => {
  it('matches "Санкт-Петербург" with locative inflection', () => {
    expect(detectCities('наличие в Санкт-Петербурге')).toEqual(['Санкт-Петербург']);
  });

  it('matches "Питер"/"спб" aliases', () => {
    expect(detectCities('в Питере')).toEqual(['Санкт-Петербург']);
    expect(detectCities('в спб')).toEqual(['Санкт-Петербург']);
  });

  it('expands Москва to Moscow + region warehouses', () => {
    const cities = detectCities('есть ли в Москве');
    expect(cities).toContain('Москва, Кантемировская');
    expect(cities).toContain('Королёв');
    expect(cities).toContain('МО, Клин');
    expect(cities).toHaveLength(3);
  });

  it('matches Казань via stem (казан-)', () => {
    expect(detectCities('в казани')).toEqual(['Казань']);
    expect(detectCities('Казань на складе')).toEqual(['Казань']);
  });

  it('matches Краснодар with case ending', () => {
    expect(detectCities('в краснодаре')).toEqual(['Краснодар']);
  });

  it('returns multiple cities for "и"-joined', () => {
    const cities = detectCities('в москве и питере');
    expect(cities).toContain('Санкт-Петербург');
    expect(cities).toContain('Москва, Кантемировская');
  });

  it('returns empty when no city mentioned', () => {
    expect(detectCities('винты M4 длиной 45 мм')).toEqual([]);
  });

  it('ignores "москва" inside other words', () => {
    expect(detectCities('товары москвич производства')).toEqual([]);
  });
});
