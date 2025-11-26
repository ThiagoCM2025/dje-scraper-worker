import { chromium } from 'playwright';

interface ScrapeParams {
  oabNumber: string;
  oabState: string;
  startDate?: string;
  endDate?: string;
}

interface Publication {
  data_disponibilizacao: string;
  caderno: string;
  pagina: string;
  conteudo: string;
  numero_processo?: string;
}

export async function scrapeTJSP(params: ScrapeParams): Promise<{
  success: boolean;
  publications: Publication[];
  error?: string;
}> {
  console.log(`🔍 Iniciando scraping TJSP para OAB ${params.oabNumber}/${params.oabState}`);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // Acessar DJe
    console.log('📄 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle'
    });

    // Aguardar formulário carregar
    await page.waitForSelector('input[name="dadosConsulta.nuOAB"]', { timeout: 10000 });

    // Preencher OAB
    await page.fill('input[name="dadosConsulta.nuOAB"]', params.oabNumber);
    
    // Selecionar UF
    await page.selectOption('select[name="dadosConsulta.ufOAB"]', params.oabState);

    // Preencher datas se fornecidas
    if (params.startDate) {
      await page.fill('input[name="dadosConsulta.dtInicio"]', formatDate(params.startDate));
    }
    if (params.endDate) {
      await page.fill('input[name="dadosConsulta.dtFim"]', formatDate(params.endDate));
    }

    // Submeter busca
    console.log('🔎 Executando busca...');
    await page.click('input[type="submit"][value="Pesquisar"]');

    // Aguardar resultados
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Extrair publicações
    const publications = await extractPublications(page);
    
    console.log(`✅ ${publications.length} publicações encontradas`);

    return {
      success: true,
      publications
    };

  } catch (err: any) {
    console.error('❌ Erro no scraping:', err.message);
    return {
      success: false,
      publications: [],
      error: err.message
    };
  } finally {
    await browser.close();
  }
}

async function extractPublications(page: any): Promise<Publication[]> {
  const publications: Publication[] = [];

  try {
    // Verificar se há resultados
    const noResults = await page.$('text=Nenhum resultado encontrado');
    if (noResults) {
      console.log('📭 Nenhum resultado encontrado');
      return [];
    }

    // Buscar itens de publicação
    const items = await page.$$('.fundocinza1, .fundocinza2, tr.fundocinza1, tr.fundocinza2');
    
    for (const item of items) {
      try {
        const text = await item.textContent();
        
        // Extrair data
        const dataMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
        const data = dataMatch ? dataMatch[1] : new Date().toLocaleDateString('pt-BR');

        // Extrair caderno
        const cadernoMatch = text.match(/Caderno:\s*([^\n]+)/i);
        const caderno = cadernoMatch ? cadernoMatch[1].trim() : 'Judicial';

        // Extrair página
        const paginaMatch = text.match(/Página:\s*(\d+)/i);
        const pagina = paginaMatch ? paginaMatch[1] : '1';

        // Extrair número do processo
        const processoMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
        const numeroProcesso = processoMatch ? processoMatch[1] : undefined;

        publications.push({
          data_disponibilizacao: data,
          caderno,
          pagina,
          conteudo: text.substring(0, 5000),
          numero_processo: numeroProcesso
        });
      } catch (e) {
        // Ignorar item com erro
      }
    }
  } catch (err) {
    console.error('Erro ao extrair publicações:', err);
  }

  return publications;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('pt-BR');
}
