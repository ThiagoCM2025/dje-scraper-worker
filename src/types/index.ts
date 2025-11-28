export interface Publication {
  date: string;
  type: string;
  content: string;
  processNumber?: string;
  court?: string;
  instance?: string;
  subject?: string;
  parties?: string[];
  lawyers?: string[];
}

export interface ScrapingResult {
  success: boolean;
  publications: Publication[];
  error?: string;
}

export type ScraperFunction = (oabNumber: string, targetDate: string) => Promise<ScrapingResult>;
