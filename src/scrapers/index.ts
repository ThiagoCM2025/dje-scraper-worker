import { ScrapingResult } from '../types.js';

export interface Scraper {
  (oabNumber: string, oabState: string, targetDate: string): Promise<ScrapingResult>;
}

export function getScraperForTribunal(tribunal: string): Scraper {
  const scrapers: Record<string, Scraper> = {
    TJSP: async (oab, state, date) => {
      const { scrapeTJSP } = await import('./tjsp.js');
      return scrapeTJSP(oab, state, date);
    },
  };

  return scrapers[tribunal] || scrapers.TJSP;
}
