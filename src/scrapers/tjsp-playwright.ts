import { Browser } from 'playwright';
import type { Publication, ScrapingJob, TribunalScraper } from '../types.js';

/**
 * IMPORTANTE:
 *  - Este código já navega até a página principal do DJe TJSP.
 *  - Os seletores de campos/filtros/resultados PRECISAM ser ajustados
 *    com o navegador aberto (Playwright) olhando o HTML real.
 *  - Objetivo aqui: deixar toda a estrutura pronta, com logs claros.
 */
export const scrapeTjsp: TribunalScraper = async (
  browser: Browser,
  job: ScrapingJob
): Promise<Publication[]> => {
  const page = await browser.newPage();
  const targetDateBr = job.target_date.split('-').reverse().join('/'); // YYYY-MM-DD -> DD/MM/YYYY

  console.log('[TJSP] Iniciando scraping para OAB', job.oab_number, job.oab_state, 'data', targetDateBr);

  try {
    await page.goto('https://dje.tjsp.jus.br/cdje/index.do', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });

    // TODO 1: aceitar cookies / avisos se existir
    // try { await page.click('text=Aceito'); } catch {}

    // TODO 2: configurar filtros básicos
    // Exemplo: número da edição, caderno, seção. Já vimos no HTML:
    //  - input#nuDiario
    //  - select#cadernos
    //  - select#secoes
    //
    // Você deve decidir se quer buscar por "edição" ou por "data".
    // O site TJSP tem fluxo complexo; ajuste conforme sua estratégia.

    // Exemplo DIDÁTICO (não é garantido funcionar em produção):
    try {
      // Se souber o número da edição, preencha em #nuDiario
      // await page.fill('#nuDiario', '4247');

      // Seleciona um caderno qualquer (ex: caderno 3 - 1ª instância capital)
      // await page.selectOption('#cadernos', '3');

      // Seleciona uma seção (ex: "JUDICIAL")
      // await page.selectOption('#secoes', '10');

      // Clica em "Consultar"
      // await page.click('#consultar');
    } catch (err) {
      console.warn('[TJSP] Aviso: erro ao configurar filtros iniciais (ajuste seletores)', err);
    }

    // TODO 3: Aguardar resultados serem carregados
    // A depender da navegação, a lista pode abrir em nova aba/janela ou no mesmo frame.
    // Você deve inspecionar (via Playwright Inspector) como os resultados aparecem.

    // Exemplos de ideias (comente/descomente conforme necessário):
    // await page.waitForTimeout(5000);
    // const resultFrame = page.frame({ name: 'resultados' }) ?? page.mainFrame();

    // TODO 4: mapear itens de resultado em `Publication[]`
    //
    // Abaixo deixo um exemplo genérico que você vai adaptar:
    const publications: Publication[] = [];

    // Exemplo FICTÍCIO de loop em resultados
    // const items = await page.$$('.classe-do-item-de-resultado');
    // for (const item of items) {
    //   const text = (await item.textContent())?.trim() || '';
    //   if (!text) continue;
    //
    //   publications.push({
    //     date: job.target_date,      // ou extraído do HTML
    //     type: 'intimacao',          // definir lógica de tipo
    //     text,
    //     processNumber: undefined,   // extrair via regex, se possível
    //     parties: [],
    //     lawyers: [job.lawyer_name ?? ''],
    //     urgency: 'normal',
    //     source: 'TJSP'
    //   });
    // }

    console.log('[TJSP] Publicações coletadas (antes de filtros):', publications.length);

    return publications;
  } catch (error) {
    console.error('[TJSP] Erro durante scraping:', error);
    throw error;
  } finally {
    await page.close();
  }
};
