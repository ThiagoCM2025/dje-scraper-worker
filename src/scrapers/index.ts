import type { Browser } from 'playwright';
import type { ScrapingJob, Publication, TribunalScraper } from '../types.js';
import { scrapeTjsp } from './tjsp-playwright.js';

export function getScraperForJob(job: ScrapingJob): TribunalScraper {
  const tribunal = job.tribunal?.toUpperCase();

  if (tribunal === 'TJSP') {
    return scrapeTjsp;
  }

  // Fallback: lança erro claro se não houver scraper
  return async (_browser: Browser, _job: ScrapingJob): Promise<Publication[]> => {
    throw new Error(`Não há scraper configurado para o tribunal: ${job.tribunal}`);
  };
}
