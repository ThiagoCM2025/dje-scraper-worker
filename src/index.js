// src/index.js - Railway Worker v4.0 - ES Module Version
import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function formatDateBR(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    page.setDefaultTimeout(60000);

    console.log('[TJSP] 🌐 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    await page.waitForTimeout(3000);

    console.log('[TJSP] 📝 Preenchendo formulário...');
    
    // Campo pesquisa livre (editável)
    try {
      await page.fill('input[name="dadosConsulta.pesquisaLivre"]', searchTerm);
      console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    } catch (e) {
      await page.evaluate((term) => {
        const el = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
        if (el) { el.value = term; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, searchTerm);
    }

    // CORREÇÃO CRÍTICA: Campos de data readonly via JavaScript
    console.log('[TJSP] 📅 Preenchendo datas via JavaScript (campos readonly)...');
    
    await page.evaluate((dateValue) => {
      const dtInicio = document.querySelector('input[name="dadosConsulta.dtInicio"]');
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.classList.remove('disabled');
        dtInicio.value = dateValue;
        dtInicio.dispatchEvent(new Event('change', { bubbles: true }));
        dtInicio.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
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

    // Selecionar todos os cadernos
    try {
      await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
      console.log('[TJSP] ✅ Caderno: Todos');
    } catch (e) {
      console.log('[TJSP] ⚠️ Caderno não selecionado');
    }

    await page.waitForTimeout(1000);

    // Submeter formulário
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    const submitSelectors = ['input[type="submit"]', 'button[type="submit"]', 'input[value="Pesquisar"]'];
    let submitted = false;
    
    for (const selector of submitSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) { await btn.click(); submitted = true; break; }
      } catch (e) { continue; }
    }

    if (!submitted) {
      await page.evaluate(() => { document.querySelector('form')?.submit(); });
    }

    await page.waitForTimeout(5000);

    // Extrair publicações
    console.log('[TJSP] 📄 Extraindo publicações...');
    
    const results = await page.evaluate(() => {
      const pubs = [];
      const selectors = ['.fundocinza1', '.fundocinza2', '.itemTexto', 'tr.fundocinza1', 'tr.fundocinza2'];
      
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => {
          const text = (el.innerText || '').trim();
          if (text.length > 100) {
            const processMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/);
            pubs.push({ text: text.substring(0, 4000), processNumber: processMatch?.[1] || null });
          }
        });
        if (pubs.length > 0) break;
      }
      
      if (pubs.length === 0) {
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('Nenhum resultado') || bodyText.includes('não foram encontrad')) {
          return [{ noResults: true }];
        }
      }
      
      return pubs;
    });

    if (results.length === 1 && results[0].noResults) {
      console.log('[TJSP] ℹ️ Nenhuma publicação encontrada');
      return [];
    }

    console.log(`[TJSP] 📊 ${results.length} publicações brutas`);

    for (const result of results) {
      if (result.noResults) continue;
      
      const textLower = (result.text || '').toLowerCase();
      
      let type = 'other';
      if (textLower.includes('intimação') || textLower.includes('intimacao')) type = 'intimacao';
      else if (textLower.includes('sentença')) type = 'sentenca';
      else if (textLower.includes('despacho')) type = 'despacho';
      else if (textLower.includes('decisão')) type = 'decisao';

      let urgency = 'normal';
      if (/urgente|citação/i.test(result.text)) urgency = 'critical';
      else if (/intimação pessoal|sentença/i.test(result.text)) urgency = 'high';

      publications.push({
        date: targetDate,
        type,
        text: result.text,
        processNumber: result.processNumber,
        urgency,
        source: 'TJSP_RAILWAY_V4',
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

async function sendToWebhook(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando resultados...`);
  
  const payload = {
    jobId: job.id,
    job_id: job.id,
    oab_number: job.oab_number,
    target_date: job.target_date,
    status: errorMessage ? 'failed' : 'completed',
    publications,
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
    console.log(`[WORKER] ✅ Resultado:`, JSON.stringify(result));
    
  } catch (error) {
    console.error(`[WORKER] ❌ Erro webhook:`, error.message);
  }
}

async function main() {
  console.log('[WORKER] 🚀 DJe Scraper Worker v4.0 iniciado');
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL}`);
  
  await processJobs();
  
  console.log('[WORKER] ♾️ Próxima execução em 5 minutos.');
  setInterval(async () => {
    console.log('[WORKER] ⏰ Cron trigger');
    await processJobs();
  }, 5 * 60 * 1000);
}

main();
