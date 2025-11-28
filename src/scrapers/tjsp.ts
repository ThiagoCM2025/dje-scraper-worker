import { ScrapingResult } from '../types.js';

/**
 * Scraper do TJSP (Tribunal de Justiça de São Paulo)
 * ATENÇÃO: Este é um scraper de teste. Retorna dados simulados.
 */
export async function scrapeTJSP(
  oabNumber: string,
  oabState: string,
  targetDate: string
): Promise<ScrapingResult> {
  console.log(`[TJSP] 🕷️ Scraping TJSP - OAB: ${oabNumber}/${oabState} - Data: ${targetDate}`);

  try {
    // DADOS DE TESTE - Substituir por scraping real com Playwright
    const testPublications = [
      {
        date: targetDate,
        type: 'intimacao',
        text: `INTIMAÇÃO - Processo nº 1234567-89.2025.8.26.0100 - Vistos. Fica a parte autora intimada para manifestação no prazo de 15 dias. OAB ${oabNumber}/${oabState}`,
        processNumber: '1234567-89.2025.8.26.0100',
        parties: ['João da Silva', 'Maria Santos'],
        lawyers: [`OAB/${oabState} ${oabNumber}`],
        urgency: 'normal' as const,
        source: 'TJSP - DJE',
      },
      {
        date: targetDate,
        type: 'sentenca',
        text: `SENTENÇA - Processo nº 9876543-21.2025.8.26.0200 - Julgo procedente o pedido inicial. OAB ${oabNumber}/${oabState}`,
        processNumber: '9876543-21.2025.8.26.0200',
        parties: ['Pedro Oliveira', 'Ana Costa'],
        lawyers: [`OAB/${oabState} ${oabNumber}`],
        urgency: 'high' as const,
        source: 'TJSP - DJE',
      },
    ];

    console.log(`[TJSP] ✅ Scraping concluído: ${testPublications.length} publicações`);

    return {
      success: true,
      publications: testPublications,
    };
  } catch (error) {
    console.error('[TJSP] ❌ Erro no scraping:', error);
    return {
      success: false,
      publications: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
