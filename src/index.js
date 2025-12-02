// src/index.js - Railway Worker v4.0 - Fix ReadOnly Fields
const { chromium } = require('playwright');

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Função para formatar data para DD/MM/YYYY (formato TJSP)
function formatDateBR(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

// Função principal
async function processJobs() {
  console.log('[WORKER] ⏰ Processando fila...');
  console.log('[WORKER] 🔍 Buscando jobs pendentes...');
  
  try {
    const response = await fetch(`${WEBHOOK_URL}/dje-get-pending-jobs`, {
      method: 'GET',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('[WORKER] ❌ Erro ao buscar jobs:', response.status);
      return;
    }

    const { jobs, count } = await response.json();
    console.log(`[WORKER] ✅ ${count || 0} job(s) encontrado(s)`);
    
    if (!jobs || jobs.length === 0) {
      console.log('[WORKER] ℹ️ Nenhum job pendente');
      return;
    }

    for (const job of jobs) {
      console.log(`[WORKER] 🔄 Processando job: ${job.oab_number}/${job.oab_state} - ${job.target_date}`);

      try {
        const publications = await scrapeTJSP(job);
        await sendToWebhook(job, publications);
      } catch (error) {
        console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
        await sendToWebhook(job, [], error.message);
      }
    }

  } catch (error) {
    console.error('[WORKER] ❌ Erro fatal:', error);
  }
}

// Scraper TJSP v4.0 - Fix ReadOnly Fields
async function scrapeTJSP(job) {
  console.log('[TJSP] 🔍 Iniciando scraping...');
  
  const targetDate = job.target_date;
  const dateBR = formatDateBR(targetDate);
  const searchTerm = job.lawyer_name || `OAB ${job.oab_number}`;
  
  console.log(`[TJSP] 📋 OAB: ${job.oab_number}, Nome: ${job.lawyer_name || 'N/A'}, Data: ${targetDate}`);
  console.log(`[TJSP] 📅 Data formatada BR: ${dateBR}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const publications = [];

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page.setDefaultTimeout(60000);

    console.log('[TJSP] 🌐 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    // Esperar página carregar completamente
    await page.waitForTimeout(3000);

    console.log('[TJSP] 📝 Preenchendo formulário...');
    
    // 1. Preencher campo de pesquisa livre (advogado/OAB) - Este campo normalmente é editável
    try {
      await page.fill('input[name="dadosConsulta.pesquisaLivre"]', searchTerm);
      console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    } catch (e) {
      console.log('[TJSP] ⚠️ Tentando via JavaScript para pesquisaLivre...');
      await page.evaluate((term) => {
        const el = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
        if (el) {
          el.value = term;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, searchTerm);
    }

    // 2. CORREÇÃO CRÍTICA: Preencher campos de data via JavaScript (readonly fields)
    console.log('[TJSP] 📅 Preenchendo datas via JavaScript (campos readonly)...');
    
    await page.evaluate((dateValue) => {
      // Data Início
      const dtInicio = document.querySelector('input[name="dadosConsulta.dtInicio"]');
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.classList.remove('disabled');
        dtInicio.value = dateValue;
        dtInicio.dispatchEvent(new Event('change', { bubbles: true }));
        dtInicio.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      // Data Fim (mesma data para busca de dia único)
      const dtFim = document.querySelector('input[name="dadosConsulta.dtFim"]');
      if (dtFim) {
        dtFim.removeAttribute('readonly');
        dtFim.classList.remove('disabled');
        dtFim.value = dateValue;
        dtFim.dispatchEvent(new Event('change', { bubbles: true }));
        dtFim.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }, dateBR);

    console.log(`[TJSP] ✅ Datas definidas: ${dateBR}`);

    // 3. Selecionar todos os cadernos
    try {
      await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
      console.log('[TJSP] ✅ Caderno selecionado: Todos');
    } catch (e) {
      console.log('[TJSP] ⚠️ Não foi possível selecionar caderno:', e.message);
    }

    await page.waitForTimeout(1000);

    // 4. Submeter formulário
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    // Tentar diferentes seletores para o botão de submit
    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value="Pesquisar"]',
      '.botao',
      '#pesquisar'
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
      // Fallback: submit via JavaScript
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      console.log('[TJSP] ✅ Formulário submetido via JavaScript');
    }

    // 5. Aguardar resultados
    await page.waitForTimeout(5000);

    // 6. Extrair publicações
    console.log('[TJSP] 📄 Extraindo publicações...');
    
    const results = await page.evaluate(() => {
      const pubs = [];
      
      // Seletores específicos do TJSP DJe
      const selectors = [
        '.fundocinza1',
        '.fundocinza2', 
        '.itemTexto',
        'tr.fundocinza1',
        'tr.fundocinza2',
        'div.corpo table tr'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.innerText || el.textContent || '').trim();
          if (text.length > 100) {
            // Extrair número do processo CNJ
            const processMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/);
            
            pubs.push({
              text: text.substring(0, 4000),
              processNumber: processMatch ? processMatch[1] : null,
              html: el.innerHTML ? el.innerHTML.substring(0, 500) : null
            });
          }
        });
        
        if (pubs.length > 0) break;
      }
      
      // Se não encontrou nos seletores específicos, tentar no body
      if (pubs.length === 0) {
        const bodyText = document.body.innerText || '';
        // Verificar se há mensagem de "nenhum resultado"
        if (bodyText.includes('Nenhum resultado') || bodyText.includes('não foram encontrad')) {
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

    console.log(`[TJSP] 📊 Encontradas ${results.length} publicações brutas`);

    // 7. Processar e classificar publicações
    for (const result of results) {
      if (result.noResults) continue;
      
      const textLower = (result.text || '').toLowerCase();
      
      // Detectar tipo
      let type = 'other';
      if (textLower.includes('intimação') || textLower.includes('intimacao')) type = 'intimacao';
      else if (textLower.includes('sentença') || textLower.includes('sentenca')) type = 'sentenca';
      else if (textLower.includes('despacho')) type = 'despacho';
      else if (textLower.includes('decisão') || textLower.includes('decisao')) type = 'decisao';
      else if (textLower.includes('citação') || textLower.includes('citacao')) type = 'citacao';

      // Classificar urgência
      let urgency = 'normal';
      if (/urgente|urgência|imediato|citação/i.test(result.text)) urgency = 'critical';
      else if (/intimação pessoal|sentença|prazo fatal/i.test(result.text)) urgency = 'high';
      
      const prazoMatch = result.text.match(/prazo\s+de\s+(\d+)\s+dias?/i);
      if (prazoMatch) {
        const days = parseInt(prazoMatch[1]);
        if (days <= 3) urgency = 'critical';
        else if (days <= 7) urgency = 'high';
      }

      publications.push({
        date: targetDate,
        type,
        text: result.text,
        processNumber: result.processNumber,
        urgency,
        source: 'TJSP_RAILWAY_WORKER_V4',
        lawyers: [job.lawyer_name || `OAB ${job.oab_number}/${job.oab_state}`]
      });
    }

    console.log(`[TJSP] ✅ ${publications.length} publicações processadas`);

  } catch (error) {
    console.error('[TJSP] ❌ Erro:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('[TJSP] 🔒 Browser fechado');
  }

  return publications;
}

// Enviar resultados para webhook
async function sendToWebhook(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando resultados para webhook...`);
  
  const payload = {
    jobId: job.id,
    job_id: job.id,
    oab_number: job.oab_number,
    target_date: job.target_date,
    status: errorMessage ? 'failed' : 'completed',
    publications: publications,
    resultsCount: publications.length,
    error: errorMessage
  };

  try {
    const response = await fetch(`${WEBHOOK_URL}/dje-webhook-receiver`, {
      method: 'POST',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log(`[WORKER] ✅ Resultado enviado:`, JSON.stringify(result));
    
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao enviar:`, error.message);
  }
}

// Main
async function main() {
  console.log('[WORKER] 🚀 DJe Scraper Worker iniciado');
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL}`);
  
  console.log('[WORKER] 🏁 Executando processamento inicial...');
  await processJobs();
  
  console.log('[WORKER] ♾️ Worker rodando. Próxima execução em 5 minutos.');
  setInterval(async () => {
    console.log('[WORKER] ⏰ Cron trigger');
    await processJobs();
  }, 5 * 60 * 1000);
}

main();
