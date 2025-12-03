// src/index.js - DJe Scraper Worker v7.0
// EXTRAÇÃO DE INTEIRO TEOR - Clica em cada resultado para obter texto completo

import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

console.log('======================================================================');
console.log('[WORKER] 🚀 DJe Scraper Worker v7.0 - INTEIRO TEOR - Iniciando...');
console.log(`[WORKER] 📅 Data/Hora: ${new Date().toISOString()}`);
console.log('======================================================================');
console.log(`[WORKER] 🔐 WEBHOOK_URL: ${WEBHOOK_URL ? '✅ OK' : '❌ MISSING!'}`);
console.log(`[WORKER] 🔐 WEBHOOK_SECRET: ${WEBHOOK_SECRET ? `✅ OK (length=${WEBHOOK_SECRET.length})` : '❌ MISSING!'}`);
console.log('======================================================================');

if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('[WORKER] ❌ Variáveis de ambiente obrigatórias não configuradas!');
  process.exit(1);
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

function formatDateBR(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function extractOABs(text) {
  const oabs = [];
  const patterns = [
    /OAB[:\s/]*([A-Z]{2})[:\s/-]*(\d{4,6})/gi,
    /OAB[:\s/]*(\d{4,6})[:\s/-]*([A-Z]{2})/gi,
    /(\d{4,6})[/\s-]*OAB[/\s-]*([A-Z]{2})/gi,
    /([A-Z]{2})[/\s-]*(\d{4,6})/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = match[1].length > 2 ? match[1] : match[2];
      const state = match[1].length === 2 ? match[1] : match[2];
      if (num && num.length >= 4 && num.length <= 6) {
        oabs.push(`${num}/${state || 'SP'}`);
      }
    }
  }
  
  return [...new Set(oabs)];
}

function extractProcessNumber(text) {
  const match = text.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
  return match ? match[0] : null;
}

// ============================================================================
// SCRAPER TJSP - COM INTEIRO TEOR
// ============================================================================

async function scrapeTJSP(job) {
  const { oab_number, lawyer_name, target_date } = job;
  const oabClean = oab_number.replace(/[^\d]/g, '');
  const searchTerm = lawyer_name || oabClean;
  const dateBR = formatDateBR(target_date);
  
  console.log('');
  console.log('[TJSP] 🔍 Iniciando scraping v7.0 - INTEIRO TEOR...');
  console.log(`[TJSP] 📋 OAB: ${oab_number}`);
  console.log(`[TJSP] 👤 Advogado: ${lawyer_name || 'N/A'}`);
  console.log(`[TJSP] 📅 Data alvo: ${target_date} → BR: ${dateBR}`);
  console.log(`[TJSP] 🔎 Termo de busca: "${searchTerm}"`);
  
  let browser = null;
  const publications = [];
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    
    // Navegar para consulta avançada
    console.log('[TJSP] 🌐 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    console.log('[TJSP] ✅ Página carregada');
    
    // Preencher formulário
    console.log('[TJSP] 📝 Preenchendo formulário...');
    
    // Campo de pesquisa livre
    await page.fill('textarea[name="dadosConsulta.pesquisaLivre"]', `"${searchTerm}"`);
    console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    
    // Preencher datas usando JavaScript (campos readonly)
    console.log('[TJSP] 📅 Preenchendo datas (campos readonly)...');
    await page.evaluate((date) => {
      const dtInicio = document.querySelector('input[name="dadosConsulta.dtInicio"]');
      const dtFim = document.querySelector('input[name="dadosConsulta.dtFim"]');
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.value = date;
        dtInicio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (dtFim) {
        dtFim.removeAttribute('readonly');
        dtFim.value = date;
        dtFim.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, dateBR);
    console.log(`[TJSP] ✅ Datas definidas: ${dateBR}`);
    
    // Selecionar todos os cadernos
    await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
    console.log('[TJSP] ✅ Caderno: Todos (-11)');
    
    // Submeter formulário
    await page.waitForTimeout(1000);
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value="Pesquisar"]',
      '.btn-pesquisar'
    ];
    
    for (const selector of submitSelectors) {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        console.log(`[TJSP] ✅ Formulário submetido via: ${selector}`);
        break;
      }
    }
    
    // Aguardar resultados
    await page.waitForTimeout(5000);
    
    // Verificar se há resultados
    const pageContent = await page.content();
    if (pageContent.includes('Nenhum resultado encontrado') || 
        pageContent.includes('nenhuma publicação') ||
        pageContent.includes('Não foram encontradas')) {
      console.log('[TJSP] ℹ️ Nenhuma publicação encontrada para esta data');
      return publications;
    }
    
    // ========================================================================
    // EXTRAÇÃO DE INTEIRO TEOR - CLICA EM CADA RESULTADO
    // ========================================================================
    
    console.log('[TJSP] 📄 Extraindo resultados com INTEIRO TEOR...');
    
    // Identificar links de documentos
    const documentLinks = await page.$$eval(
      'a[onclick*="abreDocumento"], a[href*="documento"], .linkDocumento, td a[onclick]',
      links => links.map((a, index) => ({
        index,
        text: a.textContent.trim().substring(0, 100),
        onclick: a.getAttribute('onclick') || '',
        href: a.getAttribute('href') || ''
      }))
    );
    
    console.log(`[TJSP] 📊 ${documentLinks.length} links de documentos encontrados`);
    
    // Se não encontrou links específicos, tenta extrair da tabela
    if (documentLinks.length === 0) {
      console.log('[TJSP] 🔄 Tentando extração alternativa da tabela...');
      
      const tableRows = await page.$$eval('table tr, .resultado, .publicacao', rows => {
        return rows.map(row => ({
          text: row.textContent || '',
          html: row.innerHTML || ''
        })).filter(r => r.text.length > 50);
      });
      
      console.log(`[TJSP] 📊 ${tableRows.length} linhas de tabela encontradas`);
      
      for (const row of tableRows) {
        const oabs = [];
        const oabMatches = row.text.match(/OAB[:\s/]*([A-Z]{2})?[:\s/-]*(\d{4,6})/gi) || [];
        oabMatches.forEach(m => oabs.push(m));
        
        publications.push({
          date: target_date,
          type: 'intimacao',
          text: row.text.trim(),
          processNumber: extractProcessNumber(row.text),
          lawyers: extractOABs(row.text),
          urgency: row.text.toLowerCase().includes('urgente') ? 'high' : 'normal',
          source: 'tjsp',
          caderno: 'Geral',
          extractionMethod: 'table_fallback'
        });
      }
      
      console.log(`[TJSP] ✅ ${publications.length} publicações extraídas (fallback tabela)`);
      return publications;
    }
    
    // Processar cada documento clicando para ver inteiro teor
    const maxDocs = Math.min(documentLinks.length, 15);
    console.log(`[TJSP] 🔄 Processando ${maxDocs} documentos para inteiro teor...`);
    
    for (let i = 0; i < maxDocs; i++) {
      try {
        console.log(`[TJSP] 📖 Abrindo documento ${i + 1}/${maxDocs}...`);
        
        // Re-selecionar o link (pode ter mudado após navegação)
        const links = await page.$$('a[onclick*="abreDocumento"], a[href*="documento"], .linkDocumento, td a[onclick]');
        
        if (i >= links.length) {
          console.log(`[TJSP] ⚠️ Link ${i + 1} não encontrado após recarregamento`);
          continue;
        }
        
        // Método 1: Tentar abrir em nova aba/popup
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
          links[i].click()
        ]);
        
        let fullText = '';
        
        if (popup) {
          // Documento abriu em popup
          console.log(`[TJSP] 📄 Documento ${i + 1} abriu em popup`);
          await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
          
          fullText = await popup.evaluate(() => {
            // Buscar conteúdo em vários containers possíveis
            const selectors = [
              '#conteudo',
              '.conteudo',
              '.documento',
              '.texto',
              '#texto',
              'body'
            ];
            
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim().length > 100) {
                return el.textContent.trim();
              }
            }
            return document.body.textContent.trim();
          });
          
          await popup.close();
          
        } else {
          // Documento não abriu popup - pode ter carregado na mesma página ou em iframe
          console.log(`[TJSP] 📄 Documento ${i + 1} - verificando iframe/conteúdo`);
          
          await page.waitForTimeout(2000);
          
          // Tentar extrair de iframe
          const frames = page.frames();
          for (const frame of frames) {
            if (frame !== page.mainFrame()) {
              try {
                fullText = await frame.evaluate(() => document.body.textContent.trim());
                if (fullText.length > 200) {
                  console.log(`[TJSP] ✅ Conteúdo extraído de iframe (${fullText.length} chars)`);
                  break;
                }
              } catch (e) {}
            }
          }
          
          // Se não encontrou em iframe, tentar modal/dialog
          if (fullText.length < 200) {
            fullText = await page.evaluate(() => {
              const modals = document.querySelectorAll('.modal, .dialog, .popup, [role="dialog"], .documento-conteudo');
              for (const modal of modals) {
                if (modal.textContent.trim().length > 200) {
                  return modal.textContent.trim();
                }
              }
              return '';
            });
          }
          
          // Voltar para lista se necessário
          if (fullText.length > 200) {
            await page.goBack().catch(() => {});
            await page.waitForTimeout(1000);
          }
        }
        
        // Se conseguiu extrair texto
        if (fullText && fullText.length > 100) {
          const extractedOABs = extractOABs(fullText);
          const processNum = extractProcessNumber(fullText);
          
          console.log(`[TJSP] ✅ Doc ${i + 1}: ${fullText.length} chars`);
          console.log(`[TJSP]    📋 Processo: ${processNum || 'N/A'}`);
          console.log(`[TJSP]    🎓 OABs: ${extractedOABs.length > 0 ? extractedOABs.join(', ') : 'Nenhuma'}`);
          console.log(`[TJSP]    📝 Preview: ${fullText.substring(0, 150).replace(/\s+/g, ' ')}...`);
          
          publications.push({
            date: target_date,
            type: 'intimacao',
            text: fullText,
            processNumber: processNum,
            lawyers: extractedOABs,
            urgency: fullText.toLowerCase().includes('urgente') ? 'high' : 'normal',
            source: 'tjsp',
            caderno: 'Geral',
            extractionMethod: 'full_content'
          });
        } else {
          console.log(`[TJSP] ⚠️ Doc ${i + 1}: Texto muito curto ou vazio`);
        }
        
      } catch (docError) {
        console.error(`[TJSP] ❌ Erro no documento ${i + 1}:`, docError.message);
        
        // Tentar recuperar navegação
        try {
          await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', { timeout: 30000 });
          // Re-submeter busca seria necessário aqui para continuar
          break; // Por segurança, sai do loop se perdeu contexto
        } catch (e) {
          break;
        }
      }
      
      // Pequena pausa entre documentos
      await page.waitForTimeout(500);
    }
    
    console.log(`[TJSP] ✅ ${publications.length} publicações com inteiro teor extraídas`);
    
  } catch (error) {
    console.error('[TJSP] ❌ Erro no scraping:', error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('[TJSP] 🔒 Browser fechado');
    }
  }
  
  return publications;
}

// ============================================================================
// WEBHOOK - BUSCAR JOBS
// ============================================================================

async function fetchPendingJobs() {
  console.log('[WORKER] 📋 Buscando jobs pendentes...');
  console.log(`[WORKER] 🌐 URL: ${WEBHOOK_URL.replace('dje-webhook-receiver', 'dje-get-pending-jobs')}`);
  console.log(`[WORKER] 🔑 Enviando x-webhook-secret: length=${WEBHOOK_SECRET.length}`);
  
  try {
    const response = await fetch(
      WEBHOOK_URL.replace('dje-webhook-receiver', 'dje-get-pending-jobs'),
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': WEBHOOK_SECRET
        }
      }
    );
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[WORKER] ❌ Erro ao buscar jobs: ${response.status} - ${text}`);
      return [];
    }
    
    const data = await response.json();
    const jobs = data.jobs || [];
    
    console.log(`[WORKER] ✅ Jobs recebidos: ${jobs.length}`);
    jobs.forEach((job, i) => {
      console.log(`[WORKER]   Job ${i + 1}: OAB ${job.oab_number} - ${job.target_date}`);
    });
    
    return jobs;
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro na requisição:', error.message);
    return [];
  }
}

// ============================================================================
// WEBHOOK - ENVIAR RESULTADOS
// ============================================================================

async function sendResults(job, publications) {
  console.log(`[WORKER] 📤 Enviando ${publications.length} publicações do job ${job.id}...`);
  console.log(`[WORKER] 🌐 Receiver URL: ${WEBHOOK_URL}`);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify({
        job_id: job.id,
        monitoring_id: job.monitoring_id,
        oab_number: job.oab_number,
        lawyer_name: job.lawyer_name,
        target_date: job.target_date,
        publications: publications,
        scraped_at: new Date().toISOString(),
        worker_version: '7.0',
        extraction_method: 'full_content'
      })
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    const result = await response.json();
    console.log(`[WORKER] ✅ Resultados enviados:`, JSON.stringify(result));
    
    return result;
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro ao enviar resultados:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================================

async function processJobs() {
  console.log('');
  console.log('======================================================================');
  console.log('[WORKER] ⏰ Iniciando ciclo de processamento...');
  console.log(`[WORKER] 📅 ${new Date().toISOString()}`);
  console.log('======================================================================');
  
  const jobs = await fetchPendingJobs();
  
  if (jobs.length === 0) {
    console.log('[WORKER] ℹ️ Nenhum job pendente. Aguardando próximo ciclo.');
    return;
  }
  
  console.log(`[WORKER] 📋 ${jobs.length} job(s) para processar`);
  
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    
    console.log('');
    console.log(`[WORKER] 🔄 Processando job ${i + 1}/${jobs.length}: ${job.id}`);
    console.log(`[WORKER]    OAB: ${job.oab_number}`);
    console.log(`[WORKER]    Advogado: ${job.lawyer_name || 'N/A'}`);
    console.log(`[WORKER]    Data: ${job.target_date}`);
    
    try {
      const publications = await scrapeTJSP(job);
      
      const result = await sendResults(job, publications);
      
      console.log(`[WORKER] ✅ Job ${job.id} concluído: ${publications.length} publicações`);
      
      // Pausa entre jobs
      if (i < jobs.length - 1) {
        console.log('[WORKER] ⏳ Aguardando 5s antes do próximo job...');
        await new Promise(r => setTimeout(r, 5000));
      }
      
    } catch (error) {
      console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
    }
  }
  
  console.log('');
  console.log(`[WORKER] ✅ Ciclo concluído. ${jobs.length} job(s) processado(s).`);
}

// ============================================================================
// LOOP PRINCIPAL
// ============================================================================

async function main() {
  console.log('');
  console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
  console.log('[WORKER] DJe Scraper Worker v7.0 - INTEIRO TEOR - INICIADO');
  console.log('[WORKER] Intervalo: 5 minutos');
  console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
  console.log('');
  
  // Executar imediatamente
  await processJobs();
  
  // Loop contínuo
  console.log('');
  console.log('[WORKER] ♾️ Entrando em loop - próxima execução em 5 minutos...');
  
  setInterval(async () => {
    await processJobs();
    console.log('');
    console.log('[WORKER] ♾️ Próxima execução em 5 minutos...');
  }, INTERVAL_MS);
}

// Iniciar
main().catch(err => {
  console.error('[WORKER] ❌ Erro fatal:', err);
  process.exit(1);
});
