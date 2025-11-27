import { scrapeTJSP } from './tjsp-playwright.js';

export interface Scraper {
  scrape(params: {
    oabNumber: string;
    oabState: string;
    searchDate: string;
  }): Promise<any[]>;
}

export function getScraperForTribunal(tribunal: string): Scraper {
  switch (tribunal.toUpperCase()) {
    case 'TJSP':
      return { scrape: scrapeTJSP };
    default:
      console.warn(`⚠️ Scraper não implementado para ${tribunal}, usando TJSP como fallback`);
      return { scrape: scrapeTJSP };
  }
}
