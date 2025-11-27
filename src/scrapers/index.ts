import { Publication } from '../types';
import { scrapeTJSP } from './tjsp-playwright';

export interface Scraper {
  scrape(oabNumber: string, searchDate: string): Promise<Publication[]>;
}

export function getScraperForTribunal(tribunal: string): Scraper | null {
  switch (tribunal.toUpperCase()) {
    case 'TJSP':
      return { scrape: scrapeTJSP };
    default:
      console.warn(`⚠️ Scraper não implementado para tribunal: ${tribunal}`);
      return null;
  }
}
