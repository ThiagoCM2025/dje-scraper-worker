// =============================================================================
// DJe Scraper Worker - Railway v5.0
// VERSÃO CORRIGIDA - Envia x-webhook-secret em TODAS as requisições
// =============================================================================

import { chromium } from 'playwright';

// Variáveis de ambiente (configurar no Railway Dashboard)
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// =============================================================================
// VERIFICAÇÃO INICIAL - CRÍTICO!
// =============================================================================
console.log('='.repeat(70));
console.log('[WORKER] 🚀 DJe Scraper Worker v5.0 - Iniciando...');
console.log('[WORKER] 📅 Data/Hora:', new Date().toISOString());
console.log('='.repeat(70));
console.log('[WORKER] 🔐 WEBHOOK_URL:', WEBHOOK_URL ? '✅ OK' : '❌ MISSING!');
console.log('[WORKER] 🔐 WEBHOOK_SECRET:', WEBHOOK_SECRET ? `✅ OK (length=${WEBHOOK_SECRET.length})` : '❌ MISSING!');
console.log('='.repeat(70));

if (!WEBHOOK_URL) {
  console.error('[WORKER] ❌ ERRO FATAL: WEBHOOK_URL não configurada!');
  console.error('[WORKER] Configure no Railway Dashboard → Variables');
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.error('[WORKER] ❌ ERRO FATAL: WEBHOOK_SECRET não configurada!');
  console.error('[WORKER] Configure no Railway Dashboard → Variables');
  process.exit(1);
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function formatDateBR(dateString) {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// BUSCAR JOBS PENDENTES - COM x-webhook-secret
// =============================================================================
async function fetchPendingJobs() {
  console.log('[WORKER] 📋 Buscando jobs pendentes...');
  console.log(`[WORKER] 🌐 URL: ${WEBHOOK_URL}`);
  console.log(`[WORKER] 🔑 Enviando x-webhook-secret: length=${WEBHOOK_SECRET.length}`);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET  // ← CRÍTICO: Header de autenticação
      }
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] ❌ Erro HTTP ${response.status}:`, errorText);
      return [];
    }
    
    const data = await response.json();
    const jobCount = data.jobs?.length || 0;
    console.log(`[WORKER] ✅ Jobs recebidos: ${jobCount}`);
    
    if (jobCount > 0) {
      data.jobs.forEach((job, i) => {
        console.log(`[WORKER]   Job ${i + 1}: OAB ${job.oab_number}/${job.oab_state} - ${job.target_date}`);
      });
    }
    
    return data.jobs || [];
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro de conexão:', error.message);
    return [];
  }
}

// =============================================================================
// ENVIAR RESULTADOS - COM x-webhook-secret
// =============================================================================
async function sendResults(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando resultados do job ${job.id}...`);
  
  // URL do webhook receiver
  const receiverUrl = WEBHOOK_URL.replace('dje-get-pending-jobs', 'dje-webhook-receiver');
  console.log(`[WORKER] 🌐 Receiver URL: ${receiverUrl}`);
  
  const payload = {
    job_id: job.id,
    jobId: job.id,
    oab_number: job.oab_number,
    oab_state: job.oab_state,
    target_date: job.target_date,
    status: errorMessage ? 'failed' : 'completed',
    publications: publications,
    resultsCount: publications.length,
    error: errorMessage,
    error_message: errorMessage,
    processed_at: new Date().toISOString(),
    worker_version: 'v5.0'
  };
  
  try {
    const response = await fetch(receiverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET  // ← CRÍTICO: Header de autenticação
      },
      body: JSON.stringify(payload)
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] ❌ Erro ao enviar resultados: ${response.status}`, errorText);
      return false;
    }
    
    const result = await response.json();
    console.log(`[WORKER] ✅ Resultados enviados:`, JSON.stringify(result));
    return true;
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro ao enviar resultados:', error.message);
    return false;
  }
}

// =============================================================================
// SCRAPING TJSP - Com tratamento para campos readonly
// =============================================================================
async function scrapeTJSP(job) {
  console.log('[TJSP] 🔍 Iniciando scraping...');
  
  const oabNumber = job.oab_number;
  const oabState = job.oab_state || 'SP';
  const lawyerName = job.lawyer_name;
  const targetDate = job.target_date;
  const dateBR = formatDateBR(targetDate);
  
  // Termo de busca: nome do advogado OU número OAB
  const searchTerm = lawyerName || `OAB ${oabNumber}`;
  
  console.log(`[TJSP] 📋 OAB: ${oabNumber}/${oabState}`);
  console.log(`[TJSP] 👤 Advogado: ${lawyerName || 'N/A'}`);
  console.log(`[TJSP] 📅 Data alvo: ${targetDate} → BR: ${dateBR}`);
  console.log(`[TJSP] 🔎 Termo de busca: "${searchTerm}"`);
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  
  const publications = [];
  
  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    page.setDefaultTimeout(60000);
    
    // Navegar para página de consulta avançada
    console.log('[TJSP] 🌐 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 45000
    });
    
    await sleep(3000);
    console.log('[TJSP] ✅ Página carregada');
    
    // Preencher campo de pesquisa livre
    console.log('[TJSP] 📝 Preenchendo formulário...');
    
    try {
      await page.fill('input[name="dadosConsulta.pesquisaLivre"]', searchTerm);
      console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    } catch (e) {
      console.log('[TJSP] ⚠️ Tentando via JavaScript...');
      await page.evaluate((term) => {
        const el = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
        if (el) {
          el.value = term;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, searchTerm);
    }
    
    // CORREÇÃO CRÍTICA: Preencher campos de data readonly via JavaScript
    console.log('[TJSP] 📅 Preenchendo datas (campos readonly)...');
    
    await page.evaluate((dateValue) => {
      // Campo data início
      const dtInicio = document.querySelector('input[name="dadosConsulta.dtInicio"]');
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.classList.remove('disabled');
        dtInicio.value = dateValue;
        dtInicio.dispatchEvent(new Event('change', { bubbles: true }));
        dtInicio.dispatchEvent(new Event('blur', { bubbles: true }));
        dtInicio.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Campo data fim
      const dtFim = document.querySelector('input[name="dadosConsulta.dtFim"]');
      if (dtFim) {
        dtFim.removeAttribute('readonly');
        dtFim.classList.remove('disabled');
        dtFim.value = dateValue;
        dtFim.dispatchEvent(new Event('change', { bubbles: true }));
        dtFim.dispatchEvent(new Event('blur', { bubbles: true }));
        dtFim.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, dateBR);
    
    console.log(`[TJSP] ✅ Datas definidas: ${dateBR}`);
    
    // Selecionar todos os cadernos
    try {
      await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
      console.log('[TJSP] ✅ Caderno: Todos (-11)');
    } catch (e) {
      console.log('[TJSP] ⚠️ Não foi possível selecionar caderno');
    }
    
    await sleep(1000);
    
    // Submeter formulário
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value="Pesquisar"]',
      'button:contains("Pesquisar")'
    ];
    
    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          submitted = true;
          console.log(`[TJSP] ✅ Formulário submetido via: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!submitted) {
      console.log('[TJSP] ⚠️ Tentando submit via JavaScript...');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
    }
    
    // Aguardar carregamento dos resultados
    await sleep(5000);
    console.log('[TJSP] 📄 Extraindo resultados...');
    
    // Extrair publicações da página
    const results = await page.evaluate(() => {
      const pubs = [];
      
      // Seletores comuns do TJSP
      const selectors = [
        '.fundocinza1',
        '.fundocinza2',
        '.itemTexto',
        'tr.fundocinza1',
        'tr.fundocinza2',
        '.resultadoConsulta',
        '.itemResultado'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.innerText || el.textContent || '').trim();
          if (text.length > 100) {
            // Extrair número do processo via regex CNJ
            const processMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1,2}\.\d{2}\.\d{4})/);
            pubs.push({
              text: text.substring(0, 5000),
              processNumber: processMatch ? processMatch[1] : null
            });
          }
        });
        
        if (pubs.length > 0) break;
      }
      
      // Verificar se não há resultados
      if (pubs.length === 0) {
        const bodyText = document.body.innerText || '';
        if (
          bodyText.includes('Nenhum resultado') ||
          bodyText.includes('não foram encontrad') ||
          bodyText.includes('nenhuma publicação')
        ) {
          return [{ noResults: true }];
        }
      }
      
      return pubs;
    });
    
    // Verificar se não há resultados
    if (results.length === 1 && results[0].noResults) {
      console.log('[TJSP] ℹ️ Nenhuma publicação encontrada para esta data');
      return [];
    }
    
    console.log(`[TJSP] 📊 ${results.length} elementos brutos extraídos`);
    
    // Processar e filtrar publicações
    for (const result of results) {
      if (result.noResults) continue;
      
      const text = result.text || '';
      const textLower = text.toLowerCase();
      
      // Verificar relevância: contém OAB ou nome do advogado
      const containsOAB = text.includes(oabNumber);
      const containsLawyer = lawyerName && textLower.includes(lawyerName.toLowerCase());
      
      // Se não filtrar por relevância, incluir tudo (para debug)
      // Em produção, descomentar: if (!containsOAB && !containsLawyer) continue;
      
      // Classificar tipo de publicação
      let type = 'other';
      if (textLower.includes('intimação') || textLower.includes('intimacao')) type = 'intimacao';
      else if (textLower.includes('sentença') || textLower.includes('sentenca')) type = 'sentenca';
      else if (textLower.includes('despacho')) type = 'despacho';
      else if (textLower.includes('decisão') || textLower.includes('decisao')) type = 'decisao';
      else if (textLower.includes('citação') || textLower.includes('citacao')) type = 'citacao';
      
      // Classificar urgência
      let urgency = 'normal';
      if (/urgente|urgentíssim|citação/i.test(text)) urgency = 'critical';
      else if (/intimação pessoal|sentença|decisão/i.test(text)) urgency = 'high';
      
      publications.push({
        date: targetDate,
        type: type,
        text: text,
        processNumber: result.processNumber,
        urgency: urgency,
        tribunal: 'TJSP',
        caderno: 'DJe',
        source: 'RAILWAY_WORKER_V5',
        oab_number: oabNumber,
        oab_state: oabState,
        lawyers: [lawyerName || `OAB ${oabNumber}/${oabState}`]
      });
    }
    
    console.log(`[TJSP] ✅ ${publications.length} publicações processadas`);
    
  } catch (error) {
    console.error('[TJSP] ❌ Erro no scraping:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('[TJSP] 🔒 Browser fechado');
  }
  
  return publications;
}

// =============================================================================
// PROCESSAMENTO PRINCIPAL
// =============================================================================
async function processJobs() {
  console.log('\n' + '='.repeat(70));
  console.log('[WORKER] ⏰ Iniciando ciclo de processamento...');
  console.log('[WORKER] 📅', new Date().toISOString());
  console.log('='.repeat(70));
  
  try {
    // Buscar jobs pendentes
    const jobs = await fetchPendingJobs();
    
    if (jobs.length === 0) {
      console.log('[WORKER] ℹ️ Nenhum job pendente. Aguardando próximo ciclo.');
      return;
    }
    
    console.log(`[WORKER] 📋 ${jobs.length} job(s) para processar`);
    
    // Processar cada job
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      console.log(`\n[WORKER] 🔄 Processando job ${i + 1}/${jobs.length}: ${job.id}`);
      console.log(`[WORKER]    OAB: ${job.oab_number}/${job.oab_state}`);
      console.log(`[WORKER]    Advogado: ${job.lawyer_name || 'N/A'}`);
      console.log(`[WORKER]    Data: ${job.target_date}`);
      
      try {
        // Executar scraping
        const publications = await scrapeTJSP(job);
        
        // Enviar resultados
        await sendResults(job, publications, null);
        
        console.log(`[WORKER] ✅ Job ${job.id} concluído: ${publications.length} publicações`);
        
      } catch (error) {
        console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
        
        // Enviar erro
        await sendResults(job, [], error.message);
      }
      
      // Pausa entre jobs para evitar sobrecarga
      if (i < jobs.length - 1) {
        console.log('[WORKER] ⏳ Aguardando 5s antes do próximo job...');
        await sleep(5000);
      }
    }
    
    console.log(`\n[WORKER] ✅ Ciclo concluído. ${jobs.length} job(s) processado(s).`);
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro fatal no ciclo:', error.message);
  }
}

// =============================================================================
// MAIN - LOOP PRINCIPAL
// =============================================================================
async function main() {
  console.log('\n' + '🚀'.repeat(35));
  console.log('[WORKER] DJe Scraper Worker v5.0 - INICIADO');
  console.log('[WORKER] Intervalo: 5 minutos');
  console.log('🚀'.repeat(35) + '\n');
  
  // Executar imediatamente na inicialização
  await processJobs();
  
  // Agendar execução a cada 5 minutos
  console.log('\n[WORKER] ♾️ Entrando em loop - próxima execução em 5 minutos...');
  
  setInterval(async () => {
    await processJobs();
    console.log('\n[WORKER] ♾️ Próxima execução em 5 minutos...');
  }, 5 * 60 * 1000); // 5 minutos
}

// Iniciar worker
main().catch((error) => {
  console.error('[WORKER] ❌ ERRO FATAL:', error);
  process.exit(1);
});
