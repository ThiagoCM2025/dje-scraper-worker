const playwright = require('playwright');

// ============================================
// WORKER v11.1 - DJEN/DataJUD
// ============================================
// IMPORTANTE: Este worker NÃO usa SUPABASE_SERVICE_KEY
// Toda comunicação com Supabase é via Edge Functions
// ============================================

const CONFIG = {
  // URLs das Edge Functions (autenticação via WEBHOOK_SECRET)
  GET_JOBS_URL: `${process.env.SUPABASE_URL}/functions/v1/dje-get-pending-jobs`,
  WEBHOOK_URL: `${process.env.SUPABASE_URL}/functions/v1/dje-webhook-receiver`,
  
  // Credenciais
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  DATAJUD_API_KEY: process.env.DATAJUD_API_KEY || null,
  
  // Configurações
  CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutos
  MAX_RETRIES: 3,
  
  // URLs dos sistemas
  DJEN_URL: 'https://comunica.pje.jus.br/',
  DIARIO_CNJ_URL: 'https://diario.cnj.jus.br/',
  DATAJUD_API_URL: 'https://api-publica.datajud.cnj.jus.br/'
};

// ============================================
// VALIDAÇÃO DE AMBIENTE (SEM SERVICE_KEY!)
// ============================================
function validarAmbiente() {
  const erros = [];
  
  if (!process.env.SUPABASE_URL) {
    erros.push('SUPABASE_URL não configurada');
  }
  
  if (!process.env.WEBHOOK_SECRET) {
    erros.push('WEBHOOK_SECRET não configurada');
  }
  
  // NOTA: SUPABASE_SERVICE_KEY NÃO é necessária!
  // O Worker usa apenas Edge Functions com WEBHOOK_SECRET
  
  if (erros.length > 0) {
    console.error('========================================');
    console.error('[ERRO] Configuração incompleta:');
    erros.forEach(e => console.error(`  - ${e}`));
    console.error('========================================');
    console.error('Variáveis necessárias:');
    console.error('  - SUPABASE_URL: URL do projeto Supabase');
    console.error('  - WEBHOOK_SECRET: Secret para autenticação com Edge Functions');
    console.error('  - DATAJUD_API_KEY: (opcional) Chave da API DataJUD');
    console.error('========================================');
    return false;
  }
  
  console.log('========================================');
  console.log('[OK] Ambiente configurado corretamente');
  console.log(`  SUPABASE_URL: ${process.env.SUPABASE_URL?.substring(0, 30)}...`);
  console.log(`  WEBHOOK_SECRET: ${process.env.WEBHOOK_SECRET ? '***configurado***' : 'NÃO CONFIGURADO'}`);
  console.log(`  DATAJUD_API_KEY: ${process.env.DATAJUD_API_KEY ? '***configurado***' : 'não configurado (opcional)'}`);
  console.log('========================================');
  return true;
}

// ============================================
// BUSCAR JOBS PENDENTES (via Edge Function)
// ============================================
async function buscarJobsPendentes() {
  console.log('[JOBS] Buscando jobs pendentes via Edge Function...');
  
  try {
    const response = await fetch(CONFIG.GET_JOBS_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': CONFIG.WEBHOOK_SECRET
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[JOBS] Erro HTTP ${response.status}: ${errorText}`);
      return [];
    }
    
    const data = await response.json();
    const jobs = data.jobs || [];
    
    console.log(`[JOBS] ${jobs.length} job(s) encontrado(s)`);
    return jobs;
    
  } catch (error) {
    console.error('[JOBS] Erro ao buscar jobs:', error.message);
    return [];
  }
}

// ============================================
// ENVIAR RESULTADOS (via Edge Function)
// ============================================
async function enviarResultados(jobId, publications, error = null) {
  console.log(`[WEBHOOK] Enviando resultados do job ${jobId}...`);
  
  try {
    const payload = {
      job_id: jobId,
      success: !error,
      publications: publications || [],
      error_message: error,
      source: 'DJEN_V11',
      worker_version: 'v11.1-DJEN',
      scraped_at: new Date().toISOString()
    };
    
    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': CONFIG.WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WEBHOOK] Erro HTTP ${response.status}: ${errorText}`);
      return false;
    }
    
    console.log(`[WEBHOOK] Resultados enviados com sucesso`);
    return true;
    
  } catch (error) {
    console.error('[WEBHOOK] Erro ao enviar resultados:', error.message);
    return false;
  }
}

// ============================================
// SCRAPING DO DJEN (comunica.pje.jus.br)
// ============================================
async function scrapeDJEN(browser, job) {
  console.log(`[DJEN] Iniciando scraping para OAB: ${job.oab_number}`);
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  const publications = [];
  
  try {
    // Acessar DJEN
    console.log(`[DJEN] Acessando ${CONFIG.DJEN_URL}...`);
    await page.goto(CONFIG.DJEN_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    // Tentar encontrar campos de busca
    const searchSelectors = [
      'input[name*="oab"]',
      'input[name*="advogado"]',
      'input[id*="oab"]',
      'input[id*="advogado"]',
      'input[placeholder*="OAB"]',
      'input[placeholder*="advogado"]',
      '#pesquisaLivre',
      'input[type="text"]'
    ];
    
    let searchField = null;
    for (const selector of searchSelectors) {
      const element = await page.$(selector);
      if (element) {
        searchField = element;
        console.log(`[DJEN] Campo de busca encontrado: ${selector}`);
        break;
      }
    }
    
    if (searchField) {
      // Preencher busca
      const searchTerm = job.lawyer_name || job.oab_number;
      await searchField.fill(searchTerm);
      console.log(`[DJEN] Termo de busca: ${searchTerm}`);
      
      // Tentar submeter
      const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Pesquisar"), button:has-text("Buscar")');
      if (submitButton) {
        await submitButton.click();
        await page.waitForTimeout(5000);
      }
      
      // Extrair resultados
      const results = await page.$$('div.resultado, div.publicacao, tr.resultado, .intimacao, .publicacao-item');
      console.log(`[DJEN] ${results.length} resultados encontrados`);
      
      for (const result of results) {
        try {
          const text = await result.textContent();
          if (text && text.length > 50) {
            const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
            publications.push({
              text: text.trim().substring(0, 5000),
              date: dateMatch ? dateMatch[1] : new Date().toLocaleDateString('pt-BR'),
              source: 'DJEN',
              tribunal: 'TJSP',
              type: 'intimacao'
            });
          }
        } catch (e) {
          // Ignorar erros de extração individual
        }
      }
    } else {
      console.log('[DJEN] Campo de busca não encontrado, tentando extrair conteúdo geral...');
      
      // Capturar screenshot para debug
      await page.screenshot({ path: '/tmp/djen_debug.png' });
      console.log('[DJEN] Screenshot salvo em /tmp/djen_debug.png');
    }
    
  } catch (error) {
    console.error('[DJEN] Erro no scraping:', error.message);
  } finally {
    await context.close();
  }
  
  return publications;
}

// ============================================
// FALLBACK: API DATAJUD
// ============================================
async function buscarDataJUD(job) {
  if (!CONFIG.DATAJUD_API_KEY) {
    console.log('[DATAJUD] API Key não configurada, pulando fallback');
    return [];
  }
  
  console.log(`[DATAJUD] Buscando movimentações para: ${job.lawyer_name || job.oab_number}`);
  
  const publications = [];
  
  try {
    // DataJUD usa Elasticsearch
    const searchBody = {
      size: 20,
      query: {
        bool: {
          should: [
            { match: { "movimentos.complementosTabelados.descricao": "intimação" }},
            { match: { "movimentos.complementosTabelados.descricao": "citação" }},
            { match: { "dadosBasicos.polo_ativo": job.lawyer_name || "" }},
            { match: { "dadosBasicos.polo_passivo": job.lawyer_name || "" }}
          ],
          minimum_should_match: 1
        }
      },
      sort: [{ "dataAjuizamento": { order: "desc" }}]
    };
    
    // Endpoint do TJSP no DataJUD
    const endpoint = `${CONFIG.DATAJUD_API_URL}api_publica_tjsp/_search`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `APIKey ${CONFIG.DATAJUD_API_KEY}`
      },
      body: JSON.stringify(searchBody)
    });
    
    if (response.ok) {
      const data = await response.json();
      const hits = data.hits?.hits || [];
      
      console.log(`[DATAJUD] ${hits.length} processos encontrados`);
      
      for (const hit of hits) {
        const source = hit._source;
        const movimentos = source.movimentos || [];
        
        for (const mov of movimentos) {
          const descricao = mov.complementosTabelados?.map(c => c.descricao).join(' ') || '';
          if (descricao.toLowerCase().includes('intimação') || 
              descricao.toLowerCase().includes('citação')) {
            publications.push({
              text: `${source.numeroProcesso} - ${descricao}`,
              date: mov.dataHora?.substring(0, 10) || new Date().toISOString().substring(0, 10),
              source: 'DATAJUD',
              tribunal: 'TJSP',
              type: 'movimentacao',
              process_number: source.numeroProcesso
            });
          }
        }
      }
    } else {
      console.error(`[DATAJUD] Erro HTTP ${response.status}`);
    }
    
  } catch (error) {
    console.error('[DATAJUD] Erro na busca:', error.message);
  }
  
  return publications;
}

// ============================================
// PROCESSAR UM JOB
// ============================================
async function processarJob(browser, job) {
  console.log('========================================');
  console.log(`[JOB] Processando job ${job.id}`);
  console.log(`  OAB: ${job.oab_number}`);
  console.log(`  Advogado: ${job.lawyer_name || 'N/A'}`);
  console.log(`  Tribunal: ${job.tribunal || 'TJSP'}`);
  console.log('========================================');
  
  let publications = [];
  let error = null;
  
  try {
    // Estratégia 1: Scraping DJEN
    publications = await scrapeDJEN(browser, job);
    console.log(`[JOB] DJEN retornou ${publications.length} publicações`);
    
    // Estratégia 2: Fallback para DataJUD se DJEN não retornou nada
    if (publications.length === 0) {
      console.log('[JOB] DJEN sem resultados, tentando DataJUD...');
      publications = await buscarDataJUD(job);
      console.log(`[JOB] DataJUD retornou ${publications.length} publicações`);
    }
    
  } catch (e) {
    console.error('[JOB] Erro ao processar:', e.message);
    error = e.message;
  }
  
  // Enviar resultados
  await enviarResultados(job.id, publications, error);
  
  console.log(`[JOB] Job ${job.id} finalizado`);
  console.log('========================================');
}

// ============================================
// LOOP PRINCIPAL
// ============================================
async function main() {
  console.log('========================================');
  console.log('🚀 DJE SCRAPER WORKER v11.1 - DJEN/DataJUD');
  console.log('========================================');
  console.log('IMPORTANTE: Este worker usa apenas Edge Functions');
  console.log('NÃO requer SUPABASE_SERVICE_KEY');
  console.log('========================================');
  
  // Validar ambiente
  if (!validarAmbiente()) {
    console.error('[FATAL] Ambiente inválido, encerrando...');
    process.exit(1);
  }
  
  // Iniciar browser
  console.log('[BROWSER] Iniciando Playwright...');
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  console.log('[BROWSER] Browser iniciado com sucesso');
  
  // Loop de processamento
  const processarFila = async () => {
    console.log('\n[WORKER] Verificando fila de jobs...');
    
    try {
      const jobs = await buscarJobsPendentes();
      
      if (jobs.length === 0) {
        console.log('[WORKER] Nenhum job pendente');
        return;
      }
      
      for (const job of jobs) {
        await processarJob(browser, job);
      }
      
    } catch (error) {
      console.error('[WORKER] Erro no processamento:', error.message);
    }
  };
  
  // Executar imediatamente
  await processarFila();
  
  // Agendar verificações periódicas
  console.log(`[WORKER] Próxima verificação em ${CONFIG.CHECK_INTERVAL / 60000} minutos`);
  setInterval(processarFila, CONFIG.CHECK_INTERVAL);
  
  // Manter processo vivo
  process.on('SIGTERM', async () => {
    console.log('[WORKER] Recebido SIGTERM, encerrando...');
    await browser.close();
    process.exit(0);
  });
}

// Iniciar
main().catch(error => {
  console.error('[FATAL] Erro não tratado:', error);
  process.exit(1);
});
