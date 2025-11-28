import { ScrapingResult } from '../types';
import { scrapeTJSP } from './tjsp';

export type ScraperFunction = (
  oabNumber: string,
  oabState: string,
  targetDate: string
) => Promise<ScrapingResult>;

export function getScraperForTribunal(tribunal: string): ScraperFunction {
  switch (tribunal.toUpperCase()) {
    case 'TJSP':
      return scrapeTJSP;
    default:
      console.log(`[SCRAPERS] No specific scraper for ${tribunal}, using TJSP`);
      return scrapeTJSP;
  }
}
