import { chromium, Browser, Page } from 'playwright';
import { ScrapingResult, Publication } from '../types.js';

const BUILD_VERSION = '4.0.0-playwright';

/**
 * Scraper TJSP com Playwright
 * Faz scraping real do site dje.tjsp.jus.br
 */
export async function scrapeTJSP(
  oabNumber: string,
  oabState: string,
  targetDate: string
): Promise<ScrapingResult> {
  console.log(`[TJSP v${BUILD_VERSION}] 🚀 Iniciando scraping real`);
  console.log(`[TJSP] 🎯 OAB: ${oabNumber}/${oabState} | Data: ${targetDate}`);

  let browser: Browser | null = null;
  
  try {
    // Lançar browser headless
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // Estratégia multi-caderno
    const cadernos = [
      { id: '', nome: 'Todos' },
      { id: '1', nome: '1ª Instância - Capital' },
      { id: '2', nome: '1ª Instância - Interior' },
      { id: '3', nome: '2ª Instância' }
    ];

    const allPublications: Publication[] = [];

    for (const caderno of cadernos) {
      console.log(`[TJSP] 📘 Buscando caderno: ${caderno.nome}`);
      
      try {
        const pubs = await searchCaderno(page, oabNumber, targetDate, caderno.id);
        if (pubs.length > 0) {
          console.log(`[TJSP] ✅ ${pubs.length} publicações no caderno ${caderno.nome}`);
          allPublications.push(...pubs);
        }
      } catch (error) {
        console.log(`[TJSP] ⚠️ Erro no caderno ${caderno.nome}: ${error instanceof Error ? error.message : 'erro'}`);
      }
    }

    // Remover duplicatas
    const uniquePublications = deduplicatePublications(allPublications);

    console.log(`[TJSP] 🎯 Total: ${uniquePublications.length} publicações únicas`);

    return {
      success: true,
      publications: uniquePublications,
    };

  } catch (error) {
    console.error('[TJSP] ❌ Erro no scraping:', error);
    return {
      success: false,
      publications: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('[TJSP] 🔒 Browser fechado');
    }
  }
}

/**
 * Busca em um caderno específico
 */
async function searchCaderno(
  page: Page,
  oabNumber: string,
  targetDate: string,
  cadernoId: string
): Promise<Publication[]> {
  const baseUrl = 'https://dje.tjsp.jus.br';
  
  // 1. Navegar para página inicial
  await page.goto(`${baseUrl}/cdje/index.do`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 2. Converter data para formato BR
  const dateBR = formatDateBR(targetDate);
  
  // 3. Preencher formulário
  // Campo de palavra-chave (número OAB)
  const palavrasChaveSelector = 'input[name="dadosConsulta.palavrasChave"]';
  await page.waitForSelector(palavrasChaveSelector, { timeout: 10000 });
  await page.fill(palavrasChaveSelector, oabNumber);

  // Data de
  const dataDeSelector = 'input[name="dadosConsulta.dtPublicacaoDe"]';
  if (await page.locator(dataDeSelector).isVisible()) {
    await page.fill(dataDeSelector, dateBR);
  }

  // Data até
  const dataAteSelector = 'input[name="dadosConsulta.dtPublicacaoAte"]';
  if (await page.locator(dataAteSelector).isVisible()) {
    await page.fill(dataAteSelector, dateBR);
  }

  // Caderno (se especificado)
  if (cadernoId) {
    const cadernoSelector = 'select[name="dadosConsulta.cdCaderno"]';
    if (await page.locator(cadernoSelector).isVisible()) {
      await page.selectOption(cadernoSelector, cadernoId);
    }
  }

  // 4. Clicar em pesquisar
  const submitButton = page.locator('input[type="submit"], button[type="submit"]').first();
  await submitButton.click();

  // 5. Aguardar resultado
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // 6. Obter HTML e extrair publicações
  const html = await page.content();
  
  // Verificar se retornou página de erro ou sem resultados
  if (hasNoResultsMessage(html)) {
    console.log(`[TJSP] ℹ️ Sem resultados para caderno ${cadernoId || 'todos'}`);
    return [];
  }

  // Extrair publicações
  return parsePublications(html, oabNumber, targetDate);
}

/**
 * Verifica se a página indica "sem resultados"
 */
function hasNoResultsMessage(html: string): boolean {
  const noResultPatterns = [
    /nenhuma publica[çc][ãa]o encontrada/i,
    /n[ãa]o foram encontrad/i,
    /sem resultados/i,
    /nenhum resultado/i,
    /0 resultados/i,
    /nenhum registro/i
  ];
  
  return noResultPatterns.some(pattern => pattern.test(html));
}

/**
 * Extrai publicações do HTML
 */
function parsePublications(html: string, oabNumber: string, targetDate: string): Publication[] {
  const publications: Publication[] = [];
  
  // Verificar se contém conteúdo relevante
  const hasCNJ = /\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}/.test(html);
  const hasOAB = html.toLowerCase().includes(oabNumber.toLowerCase());
  
  if (!hasCNJ && !hasOAB) {
    return [];
  }

  // ESTRATÉGIA 1: Tabela principal
  const tableMatch = html.match(/<table[^>]+id=["']tabelaTodasPublicacoes["'][^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch) {
    return extractFromTable(tableMatch[0], oabNumber, targetDate);
  }

  // ESTRATÉGIA 2: Qualquer tabela com conteúdo
  const tables = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi);
  if (tables) {
    for (const table of tables) {
      const rowCount = (table.match(/<tr/gi) || []).length;
      if (rowCount > 2) {
        const pubs = extractFromTable(table, oabNumber, targetDate);
        if (pubs.length > 0) return pubs;
      }
    }
  }

  // ESTRATÉGIA 3: Regex por processos CNJ
  const processPattern = /\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}/g;
  const matches = html.match(processPattern);
  
  if (matches) {
    const uniqueProcesses = [...new Set(matches)];
    for (const processNum of uniqueProcesses) {
      const idx = html.indexOf(processNum);
      const context = html.substring(Math.max(0, idx - 500), Math.min(html.length, idx + 1000));
      const texto = cleanText(context);
      
      if (texto && texto.length > 100) {
        publications.push({
          date: targetDate,
          type: detectPublicationType(texto),
          text: texto.substring(0, 2000),
          processNumber: processNum,
          parties: extractParties(texto),
          lawyers: [`OAB/${oabNumber}`],
          urgency: classifyUrgency(texto),
          source: 'TJSP - DJE'
        });
      }
    }
  }

  return publications;
}

/**
 * Extrai publicações de uma tabela HTML
 */
function extractFromTable(tableHtml: string, oabNumber: string, targetDate: string): Publication[] {
  const publications: Publication[] = [];
  const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  
  let startIndex = 0;
  if (rows.length > 0 && rows[0].toLowerCase().includes('<th')) {
    startIndex = 1;
  }

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    
    if (cells.length < 2) continue;

    const contentText = cells.map(c => cleanText(c)).join(' ');
    
    if (contentText.length < 50) continue;
    if (!/processo|advogado|oab|intimação|despacho|sentença/i.test(contentText)) continue;

    const processNumber = extractProcessNumber(contentText);

    publications.push({
      date: targetDate,
      type: detectPublicationType(contentText),
      text: contentText.substring(0, 2000),
      processNumber: processNumber || undefined,
      parties: extractParties(contentText),
      lawyers: [`OAB/${oabNumber}`],
      urgency: classifyUrgency(contentText),
      source: 'TJSP - DJE'
    });
  }

  return publications;
}

// ================== HELPERS ==================

function formatDateBR(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProcessNumber(text: string): string | null {
  const match = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/);
  return match ? match[1] : null;
}

function detectPublicationType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('intimação') || lower.includes('intimacao')) return 'intimacao';
  if (lower.includes('sentença') || lower.includes('sentenca')) return 'sentenca';
  if (lower.includes('despacho')) return 'despacho';
  if (lower.includes('decisão') || lower.includes('decisao')) return 'decisao';
  if (lower.includes('juntada')) return 'juntada';
  if (lower.includes('citação') || lower.includes('citacao')) return 'citacao';
  return 'other';
}

function extractParties(text: string): string[] {
  const parties: string[] = [];
  
  const autorRegex = /(?:autor|requerente|exequente)[:\s]+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]+?)(?:\s+-|,|\.|\n)/gi;
  const reuRegex = /(?:réu|requerido|executado)[:\s]+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]+?)(?:\s+-|,|\.|\n)/gi;
  
  let match;
  while ((match = autorRegex.exec(text)) !== null) {
    parties.push(match[1].trim());
  }
  while ((match = reuRegex.exec(text)) !== null) {
    parties.push(match[1].trim());
  }
  
  return [...new Set(parties)];
}

function classifyUrgency(text: string): 'low' | 'normal' | 'high' | 'critical' {
  const lower = text.toLowerCase();
  
  if (/urgente|urgência|imediato|citação/.test(lower)) return 'critical';
  if (/intimação pessoal|sentença|prazo fatal/.test(lower)) return 'high';
  if (/prazo de \d+ dias?/.test(lower)) {
    const match = lower.match(/prazo de (\d+) dias?/);
    if (match) {
      const days = parseInt(match[1]);
      if (days <= 3) return 'critical';
      if (days <= 7) return 'high';
    }
  }
  
  return 'normal';
}

function deduplicatePublications(publications: Publication[]): Publication[] {
  const seen = new Set<string>();
  return publications.filter(pub => {
    const key = pub.processNumber || pub.text.substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
