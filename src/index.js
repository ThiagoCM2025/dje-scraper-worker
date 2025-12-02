// ========================================
// DJE SCRAPER WORKER v1.0
// Railway + Playwright
// Sem necessidade de SUPABASE_SERVICE_ROLE_KEY
// ========================================

import { chromium } from 'playwright';

// ========== CONFIGURAÇÃO ==========
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CRON_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Validar variáveis
if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('[WORKER] ❌ Variáveis não configuradas!');
  console.error('Necessário: WEBHOOK_URL, WEBHOOK_SECRET');
  process.exit(1);
}

console.log('[WORKER] 🚀 DJe Scraper Worker iniciado');
console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL}`);

// ========== BUSCAR JOBS PENDENTES ==========
async function getPendingJobs() {
  console.log('[WORKER] 🔍 Buscando jobs pendentes...');
  
  try {
    const response = await fetch(`${WEBHOOK_URL}/dje-get-pending-jobs`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`[WORKER] ✅ ${data.count || 0} job(s) encontrado(s)`);
    return data.jobs || [];

  } catch (error) {
    console.error('[WORKER] ❌ Erro ao buscar jobs:', error.message);
    return [];
  }
}

// ========== ENVIAR RESULTADOS ==========
async function sendResults(payload) {
  console.log(`[WORKER] 📤 Enviando resultados para webhook...`);

  try {
    const response = await fetch(`${WEBHOOK_URL}/dje-webhook-receiver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('[WORKER] ✅ Resultado enviado:', JSON.stringify(result));
    return result;

  } catch (error) {
    console.error('[WORKER] ❌ Erro ao enviar:', error.message);
    throw error;
  }
}

// ========== SCRAPING TJSP ==========
async function scrapeTJSP(oabNumber, lawyerName, targetDate) {
  console.log(`[TJSP] 🔍 Iniciando scraping...`);
  console.log(`[TJSP] 📋 OAB: ${oabNumber}, Nome: ${lawyerName}, Data: ${targetDate}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const publications = [];

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    // Converter data para DD/MM/YYYY
    const [year, month, day] = targetDate.split('-');
    const dateBR = `${day}/${month}/${year}`;

    console.log(`[TJSP] 🌐 Acessando DJe TJSP...`);
    
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    console.log(`[TJSP] 📝 Preenchendo formulário...`);

    await page.waitForSelector('input[name="dadosConsulta.pesquisaLivre"]', { timeout: 30000 });

    // Preencher campos
    await page.fill('input[name="dadosConsulta.pesquisaLivre"]', oabNumber);
    await page.fill('input[name="dadosConsulta.dtInicio"]', dateBR);
    await page.fill('input[name="dadosConsulta.dtFim"]', dateBR);

    // Selecionar todos os cadernos
    const cadernoSelect = await page.$('select[name="dadosConsulta.cdCaderno"]');
    if (cadernoSelect) {
      await cadernoSelect.selectOption('-11');
    }

    console.log(`[TJSP] 🔎 Submetendo busca: "${oabNumber}" em ${dateBR}`);

    await page.click('input[type="submit"], button[type="submit"]');

    // Aguardar resultados
    try {
      await page.waitForSelector('.fundocinza1, .fundocinza2, .resultado, .itemPublicacao, #divConteudo', { 
        timeout: 30000 
      });
    } catch (e) {
      console.log('[TJSP] ⚠️ Timeout aguardando resultados');
    }

    await page.waitForTimeout(3000);

    const pageContent = await page.content();
    console.log(`[TJSP] 📄 HTML: ${pageContent.length} caracteres`);

    // Verificar se não há resultados
    if (pageContent.includes('Nenhum resultado encontrado') || 
        pageContent.includes('Não foram encontrados') ||
        pageContent.includes('sem resultado')) {
      console.log('[TJSP] ℹ️ Nenhuma publicação encontrada');
      return [];
    }

    // Extrair publicações
    const extractedPubs = await page.evaluate(() => {
      const results = [];
      const selectors = ['.fundocinza1', '.fundocinza2', '.itemPublicacao', 'div[class*="resultado"]', 'tr.fundocinza1', 'tr.fundocinza2'];

      for (const selector of selectors) {
        const items = document.querySelectorAll(selector);
        items.forEach(item => {
          const text = item.textContent || item.innerText || '';
          if (text.length > 50) {
            results.push({ text: text.trim() });
          }
        });
      }

      if (results.length === 0) {
        const mainContent = document.querySelector('#divConteudo, .conteudo, main');
        if (mainContent) {
          const text = mainContent.textContent || '';
          if (text.length > 100) {
            results.push({ text: text.trim() });
          }
        }
      }

      return results;
    });

    console.log(`[TJSP] 📊 ${extractedPubs.length} elemento(s) extraído(s)`);

    // Filtrar por OAB
    for (const pub of extractedPubs) {
      const text = pub.text.toUpperCase();
      const oabPattern = new RegExp(`\\b${oabNumber}\\b`, 'i');
      const hasOab = oabPattern.test(text);
      const hasName = lawyerName && text.includes(lawyerName.toUpperCase());
      
      if (hasOab || hasName) {
        const cnjMatch = text.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
        
        publications.push({
          date: targetDate,
          type: detectType(text),
          text: pub.text.substring(0, 10000),
          processNumber: cnjMatch ? cnjMatch[0] : null,
          lawyers: [lawyerName],
          urgency: detectUrgency(text),
          source: 'TJSP_PLAYWRIGHT'
        });

        console.log(`[TJSP] ✅ Publicação válida: ${cnjMatch ? cnjMatch[0] : 'CNJ não identificado'}`);
      }
    }

    console.log(`[TJSP] 🎯 ${publications.length} publicação(ões) após filtro OAB`);

  } catch (error) {
    console.error('[TJSP] ❌ Erro:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('[TJSP] 🔒 Browser fechado');
  }

  return publications;
}

// ========== HELPERS ==========
function detectType(text) {
  const t = text.toUpperCase();
  if (t.includes('CITAÇÃO') || t.includes('CITACAO')) return 'citacao';
  if (t.includes('INTIMAÇÃO') || t.includes('INTIMACAO')) return 'intimacao';
  if (t.includes('SENTENÇA') || t.includes('SENTENCA')) return 'sentenca';
  if (t.includes('DECISÃO') || t.includes('DECISAO')) return 'decisao';
  if (t.includes('DESPACHO')) return 'despacho';
  if (t.includes('ACÓRDÃO') || t.includes('ACORDAO')) return 'acordao';
  return 'publicacao';
}

function detectUrgency(text) {
  const t = text.toUpperCase();
  if (/PRAZO\s*(DE)?\s*\d+\s*(HORA|DIA)/i.test(text)) {
    const match = text.match(/PRAZO\s*(DE)?\s*(\d+)\s*(HORA|DIA)/i);
    if (match) {
      const days = parseInt(match[2]);
      if (days <= 2) return 'critical';
      if (days <= 5) return 'high';
    }
  }
  if (t.includes('URGENTE') || t.includes('URGÊNCIA')) return 'critical';
  if (t.includes('CITAÇÃO') || t.includes('CITACAO')) return 'high';
  if (t.includes('MANDADO')) return 'high';
  return 'normal';
}

// ========== PROCESSAR FILA ==========
async function processQueue() {
  console.log('[WORKER] ⏰ Processando fila...');

  try {
    const jobs = await getPendingJobs();
    
    if (jobs.length === 0) {
      console.log('[WORKER] ℹ️ Nenhum job pendente');
      return;
    }

    for (const job of jobs) {
      console.log(`[WORKER] 🔄 Processando job: ${job.oab_number}/${job.oab_state} - ${job.target_date}`);

      try {
        const publications = await scrapeTJSP(
          job.oab_number,
          job.lawyer_name,
          job.target_date
        );

        console.log(`[WORKER] ✅ ${publications.length} publicação(ões) encontrada(s)`);

        await sendResults({
          jobId: job.id,
          status: 'completed',
          publications: publications,
          resultsCount: publications.length,
          oab_number: job.oab_number,
          target_date: job.target_date
        });

        console.log(`[WORKER] ✅ Job ${job.id} concluído`);

      } catch (error) {
        console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);

        await sendResults({
          jobId: job.id,
          status: 'failed',
          error: error.message,
          oab_number: job.oab_number,
          target_date: job.target_date
        });
      }
    }

  } catch (error) {
    console.error('[WORKER] ❌ Erro fatal:', error.message);
  }
}

// ========== INICIAR ==========
console.log('[WORKER] 🏁 Executando processamento inicial...');
processQueue();

setInterval(() => {
  console.log('[WORKER] ⏰ Cron trigger');
  processQueue();
}, CRON_INTERVAL);

console.log('[WORKER] ♾️ Worker rodando. Próxima execução em 5 minutos.');
