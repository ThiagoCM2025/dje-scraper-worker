// src/scrapers/index.ts
import { ScrapingResult } from '../types';
import { scrapeTJSP } from './tjsp';

export interface Scraper {
  scrape(oabNumber: string, oabState: string, targetDate: string): Promise<ScrapingResult>;
}

export function getScraperForTribunal(tribunal: string): Scraper | null {
  const tribunalUpper = tribunal.toUpperCase();
  
  switch (tribunalUpper) {
    case 'TJSP':
      return { scrape: scrapeTJSP };
    case 'TJRJ':
      // TODO: Implementar scraper TJRJ
      console.warn(`⚠️ Scraper TJRJ não implementado ainda`);
      return { scrape: scrapeTJSP }; // Fallback temporário
    default:
      console.warn(`⚠️ Scraper não implementado para tribunal: ${tribunal}`);
      return null;
  }
}
