import { ScraperFunction } from '../types';
import { scrapeTJSP } from './tjsp';

// Mapa de tribunais para suas funções de scraping
export const scrapers: Record<string, ScraperFunction> = {
  'TJSP': scrapeTJSP,
  'tjsp': scrapeTJSP,
};

export { scrapeTJSP };
