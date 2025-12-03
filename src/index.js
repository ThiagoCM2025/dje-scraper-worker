const { chromium } = require('playwright');

// Configurações
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GET_JOBS_URL = 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-get-pending-jobs';

// Captura erros não tratados
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

/**
 * Formata data no padrão brasileiro DD/MM/YYYY
 */
function formatDateBR(dateStr) {
  const date = new Date(dateStr + 'T12:00:00Z');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Gera hash simples para deduplicação local
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * VALIDAÇÃO RELAXADA v7.0
 * Como a busca já é feita pelo nome do advogado no TJSP,
 * as publicações retornadas já são relevantes.
 * Apenas filtramos publicações muito curtas ou claramente inválidas.
 */
function isValidPublication(text, oabNumber, lawyerName) {
  if (!text || text.length < 50) {
    console.log(`[VALIDATION] ⚠️ Texto muito curto (${text?.length || 0} chars)`);
    return false;
  }
  
  const textUpper = text.toUpperCase();
  
  // Verificação básica: deve conter algum termo jurídico
  const legalTerms = [
    'PROCESSO', 'AUTOS', 'INTIMAÇÃO', 'CITAÇÃO', 'SENTENÇA', 
    'DECISÃO', 'DESPACHO', 'EXPEDIENTE', 'PUBLICAÇÃO',
    'REQUERENTE', 'REQUERIDO', 'AUTOR', 'RÉU', 'APELANTE',
    'AGRAVANTE', 'EMBARGANTE', 'IMPETRANTE', 'RECLAMANTE',
    'PRAZO', 'DIAS', 'MANIFESTAR', 'CIÊNCIA', 'VISTA'
  ];
  
  const hasLegalTerm = legalTerms.some(term => textUpper.includes(term));
  
  if (!hasLegalTerm) {
    console.log(`[VALIDATION] ⚠️ Sem termos jurídicos relevantes`);
    return false;
  }
  
  // Se buscou pelo nome do advogado e tem termos jurídicos, é válido!
  // O TJSP já fez o filtro principal
  console.log(`[VALIDATION] ✅ Publicação VÁLIDA - contém termos jurídicos`);
  return true;
}

/**
 * Extrai número de processo do texto
 */
function extractProcessNumber(text) {
  // Padrão CNJ: 0000000-00.0000.0.00.0000
  const cnjPattern = /\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}/g;
  const matches = text.match(cnjPattern);
  return matches ? matches[0] : null;
}

/**
 * Classifica urgência da publicação
 */
function classifyUrgency(text) {
  const textUpper = text.toUpperCase();
  
  if (textUpper.includes('URGENTE') || textUpper.includes('24 HORAS') || textUpper.includes('IMEDIATO')) {
    return 'critical';
  }
  if (textUpper.includes('5 DIAS') || textUpper.includes('CINCO DIAS') || textUpper.includes('CITAÇÃO')) {
    return 'high';
  }
  if (textUpper.includes('15 DIAS') || textUpper.includes('QUINZE DIAS') || textUpper.includes('PRAZO')) {
    return 'medium';
  }
  return 'normal';
}

/**
 * Scraping do DJe TJSP usando Playwright
 */
async function scrapeTJSP(job) {
  const { oab_number, oab_state, lawyer_name, target_date } = job;
  const searchTerm = lawyer_name || `OAB ${oab_number}`;
  const dateBR = formatDateBR(target_date);
  
  console.log('');
  console.log('--------------------------------------------------');
  console.log(`[TJSP] 🚀 Iniciando scraping do DJe TJSP...`);
  console.log(`[TJSP] 🔍 Termo de busca: "${searchTerm}"`);
  console.log(`[TJSP] 📅 Data alvo: ${target_date} (BR: ${dateBR})`);
  
  let browser;
  const publications = [];
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    
    // Navegar para o DJe TJSP
    console.log(`[TJSP] 🌐 Navegando para DJe TJSP...`);
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    console.log(`[TJSP] ✅ Página carregada`);
    
    // Verificar se o formulário existe
    const formExists = await page.locator('form').first().isVisible().catch(() => false);
    console.log(`[TJSP] 📝 Formulário encontrado: ${formExists ? 'SIM' : 'NÃO'}`);
    
    // Preencher campo de pesquisa livre com o NOME do advogado
    console.log(`[TJSP] 📝 Preenchendo pesquisa livre: "${searchTerm}"`);
    await page.evaluate((term) => {
      const input = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
      if (input) {
        input.removeAttribute('readonly');
        input.removeAttribute('disabled');
        input.value = term;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, searchTerm);
    console.log(`[TJSP] ✅ Campo pesquisaLivre preenchido`);
    
    // Preencher datas (início e fim iguais)
    console.log(`[TJSP] 📅 Preenchendo datas: ${dateBR}`);
    await page.evaluate((dateValue) => {
      ['dtInicio', 'dtFim'].forEach(name => {
        const input = document.querySelector(`input[name="dadosConsulta.${name}"]`);
        if (input) {
          input.removeAttribute('readonly');
          input.removeAttribute('disabled');
          input.value = dateValue;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }, dateBR);
    console.log(`[TJSP] ✅ Datas configuradas`);
    
    // Selecionar todos os cadernos
    console.log(`[TJSP] 📚 Selecionando todos os cadernos...`);
    await page.evaluate(() => {
      const select = document.querySelector('select[name="dadosConsulta.cdCaderno"]');
      if (select) {
        select.value = '-11'; // Todos os cadernos
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    console.log(`[TJSP] ✅ Caderno: Todos (-11)`);
    
    // Aguardar um pouco para os campos serem processados
    await page.waitForTimeout(1000);
    
    // Clicar no botão pesquisar
    console.log(`[TJSP] 🔍 Submetendo busca...`);
    const submitSelectors = [
      'input[type="submit"][value="Pesquisar"]',
      'input[type="submit"]',
      'button[type="submit"]',
      '.btn-pesquisar',
      '#pesquisar'
    ];
    
    for (const selector of submitSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          console.log(`[TJSP] ✅ Clicou em: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Aguardar resultados
    console.log(`[TJSP] ⏳ Aguardando resultados...`);
    await page.waitForTimeout(5000);
    
    // Extrair publicações
    console.log(`[TJSP] 📄 Extraindo publicações...`);
    
    const extractedData = await page.evaluate(() => {
      const results = [];
      
      // Estratégia 1: Tabelas de resultado
      const tables = document.querySelectorAll('table.resultTable, table.listagem, table[class*="result"]');
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const text = row.innerText?.trim();
          if (text && text.length > 100) {
            results.push({ text, source: 'table' });
          }
        });
      });
      
      // Estratégia 2: Divs de publicação
      const divSelectors = [
        'div.publicacao',
        'div.resultado',
        'div.conteudo-publicacao',
        'div[class*="publicacao"]',
        'div[class*="resultado"]',
        'div.dados',
        'div.item'
      ];
      
      divSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(div => {
          const text = div.innerText?.trim();
          if (text && text.length > 100) {
            results.push({ text, source: 'div' });
          }
        });
      });
      
      // Estratégia 3: Parágrafos longos
      document.querySelectorAll('p, span.texto, td.texto').forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 200) {
          results.push({ text, source: 'paragraph' });
        }
      });
      
      // Estratégia 4: Texto completo de áreas de resultado
      const resultAreas = document.querySelectorAll('#resultados, .resultados, #listaResultados, .lista-resultados');
      resultAreas.forEach(area => {
        const text = area.innerText?.trim();
        if (text && text.length > 100) {
          // Dividir por padrões comuns de separação
          const parts = text.split(/(?=Processo:|(?:\d{7}-\d{2}\.\d{4}))/);
          parts.forEach(part => {
            if (part.trim().length > 100) {
              results.push({ text: part.trim(), source: 'area' });
            }
          });
        }
      });
      
      return {
        results,
        htmlLength: document.body.innerHTML.length,
        textLength: document.body.innerText.length
      };
    });
    
    console.log(`[TJSP] 📊 Tamanho do HTML: ${extractedData.htmlLength} chars`);
    console.log(`[TJSP] 📊 Tamanho do texto: ${extractedData.textLength} chars`);
    console.log(`[TJSP] 📊 Publicações brutas extraídas: ${extractedData.results.length}`);
    
    // Log das primeiras 200 chars de cada publicação bruta para debug
    extractedData.results.forEach((pub, idx) => {
      console.log(`[DEBUG] Pub ${idx + 1} (${pub.source}): ${pub.text.substring(0, 150)}...`);
    });
    
    // Deduplicar e validar
    const seenHashes = new Set();
    
    for (const raw of extractedData.results) {
      const text = raw.text.trim();
      const hash = simpleHash(text.substring(0, 500));
      
      if (seenHashes.has(hash)) {
        console.log(`[VALIDATION] ⚠️ Duplicata ignorada`);
        continue;
      }
      seenHashes.add(hash);
      
      // Validação relaxada - se retornou do TJSP com o nome buscado, é válido
      if (isValidPublication(text, oab_number, lawyer_name)) {
        const processNumber = extractProcessNumber(text);
        const urgency = classifyUrgency(text);
        
        publications.push({
          text: text.substring(0, 5000),
          date: target_date,
          processNumber,
          urgency,
          source: 'TJSP',
          caderno: 'DJe',
          rawSource: raw.source
        });
      }
    }
    
    console.log(`[TJSP] 📊 Total de publicações VÁLIDAS: ${publications.length}`);
    
  } catch (error) {
    console.error(`[TJSP] ❌ Erro no scraping:`, error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[TJSP] 🔒 Browser fechado`);
    }
  }
  
  return publications;
}

/**
 * Envia publicações para o webhook
 */
async function sendToWebhook(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando ${publications.length} publicações para webhook...`);
  
  const payload = {
    job_id: job.id,
    monitoring_id: job.monitoring_id,
    oab_number: job.oab_number,
    oab_state: job.oab_state,
    lawyer_name: job.lawyer_name,
    target_date: job.target_date,
    publications: publications,
    error: errorMessage,
    scraped_at: new Date().toISOString()
  };
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    console.log(`[WORKER] ✅ Webhook response:`, JSON.stringify(result));
    return result;
  } catch (error) {
    console.error(`[WORKER] ❌ Erro no webhook:`, error.message);
    return null;
  }
}

/**
 * Busca jobs pendentes
 */
async function fetchPendingJobs() {
  console.log(`[WORKER] 🔍 Buscando jobs pendentes...`);
  console.log(`[WORKER] URL: ${GET_JOBS_URL}`);
  
  try {
    const response = await fetch(GET_JOBS_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`[WORKER] Response status: ${response.status}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const jobs = data.jobs || [];
    console.log(`[WORKER] ✅ ${jobs.length} job(s) encontrado(s)`);
    return jobs;
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao buscar jobs:`, error.message);
    return [];
  }
}

/**
 * Processa a fila de jobs
 */
async function processQueue() {
  console.log('');
  console.log('============================================================');
  console.log(`[WORKER] ⏰ ${new Date().toISOString()} - Processando fila...`);
  console.log('============================================================');
  
  const jobs = await fetchPendingJobs();
  
  if (jobs.length === 0) {
    console.log(`[WORKER] ℹ️ Nenhum job pendente. Aguardando próximo ciclo.`);
    return;
  }
  
  for (const job of jobs) {
    console.log('');
    console.log('--------------------------------------------------');
    console.log(`[WORKER] 🔄 Processando job: ${job.id}`);
    console.log(`[WORKER] 📋 OAB: ${job.oab_number}/${job.oab_state}`);
    console.log(`[WORKER] 👤 Advogado: ${job.lawyer_name}`);
    console.log(`[WORKER] 📅 Data: ${job.target_date}`);
    
    try {
      const publications = await scrapeTJSP(job);
      console.log(`[WORKER] 📊 Total de publicações válidas: ${publications.length}`);
      await sendToWebhook(job, publications);
    } catch (error) {
      console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
      await sendToWebhook(job, [], error.message);
    }
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('');
  console.log('************************************************************');
  console.log(`[WORKER] 🚀 DJe Scraper Worker v7.0 - INICIANDO`);
  console.log('************************************************************');
  console.log(`[WORKER] 🕐 Horário: ${new Date().toISOString()}`);
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL?.substring(0, 60)}...`);
  console.log(`[WORKER] 🔐 Webhook Secret: ${WEBHOOK_SECRET ? '***configurado***' : '❌ NÃO CONFIGURADO'}`);
  
  // Processar imediatamente
  await processQueue();
  
  // Configurar intervalo de 5 minutos
  console.log(`[WORKER] ♾️ Configurando execução a cada 5 minutos...`);
  setInterval(processQueue, 5 * 60 * 1000);
}

main();
