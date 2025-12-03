// ============================================================
// DJe Scraper Worker v7.0 - ES MODULE (import syntax)
// Validação relaxada para aceitar publicações do TJSP
// ============================================================

import { chromium } from 'playwright';

// Configurações
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-webhook-receiver';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const GET_JOBS_URL = process.env.GET_JOBS_URL || 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-get-pending-jobs';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpaXJtcGlmanl4Yndub2ZrdmVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDI0MzEsImV4cCI6MjA3NTA3ODQzMX0.MbhM8wkJqthfncSvhrigwu8_rFC0zGiOwvxDVIePQtc';

// ============================================================
// FUNÇÃO DE VALIDAÇÃO RELAXADA
// ============================================================
function isValidPublication(text) {
  if (!text || text.length < 50) {
    console.log(`[VALIDATION] ❌ Texto muito curto: ${text?.length || 0} chars`);
    return false;
  }
  
  // Termos jurídicos comuns que indicam publicação válida
  const legalTerms = [
    'intimação', 'intimado', 'intimada', 'intimam-se',
    'citação', 'citado', 'citada', 'cite-se',
    'sentença', 'decisão', 'despacho', 'acórdão',
    'processo', 'autos', 'ação', 'recurso',
    'prazo', 'dias', 'audiência', 'julgamento',
    'advogado', 'advogada', 'oab', 'dr.', 'dra.',
    'autor', 'autora', 'réu', 'ré', 'requerente', 'requerido',
    'vara', 'tribunal', 'juiz', 'juíza', 'comarca',
    'certidão', 'mandado', 'carta precatória',
    'execução', 'cumprimento', 'pagamento',
    'apelação', 'agravo', 'embargos'
  ];
  
  const textLower = text.toLowerCase();
  const hasLegalTerm = legalTerms.some(term => textLower.includes(term));
  
  if (hasLegalTerm) {
    console.log(`[VALIDATION] ✅ Publicação VÁLIDA (${text.length} chars, contém termos jurídicos)`);
    return true;
  }
  
  // Aceita se tiver número de processo CNJ
  const cnjPattern = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
  if (cnjPattern.test(text)) {
    console.log(`[VALIDATION] ✅ Publicação VÁLIDA (contém número CNJ)`);
    return true;
  }
  
  console.log(`[VALIDATION] ❌ Publicação sem termos jurídicos ou CNJ`);
  return false;
}

// ============================================================
// FUNÇÃO DE SCRAPING DO TJSP
// ============================================================
async function scrapeTJSP(job) {
  const { oab_number, oab_state, lawyer_name, target_date } = job;
  
  // Usa nome do advogado como termo de busca
  const searchTerm = lawyer_name || `OAB ${oab_number}`;
  
  // Formata data para DD/MM/YYYY
  const dateObj = new Date(target_date);
  const dateBR = dateObj.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  
  console.log('');
  console.log('--------------------------------------------------');
  console.log(`[TJSP] 🚀 Iniciando scraping do DJe TJSP...`);
  console.log(`[TJSP] 🔍 Termo de busca: "${searchTerm}"`);
  console.log(`[TJSP] 📅 Data alvo: ${target_date} (BR: ${dateBR})`);
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    
    console.log(`[TJSP] 🌐 Navegando para DJe TJSP...`);
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', { 
      waitUntil: 'networkidle',
      timeout: 45000 
    });
    console.log(`[TJSP] ✅ Página carregada`);
    
    // Verifica se o formulário existe
    const formExists = await page.$('form') !== null;
    console.log(`[TJSP] 📝 Formulário encontrado: ${formExists ? 'SIM' : 'NÃO'}`);
    
    // Preenche campo de pesquisa livre
    console.log(`[TJSP] 📝 Preenchendo pesquisa livre: "${searchTerm}"`);
    await page.fill('input[name="dadosConsulta.pesquisaLivre"]', searchTerm);
    console.log(`[TJSP] ✅ Campo pesquisaLivre preenchido`);
    
    // Preenche datas usando JavaScript (campos readonly)
    console.log(`[TJSP] 📅 Preenchendo datas: ${dateBR}`);
    await page.evaluate((dateValue) => {
      const dtInicio = document.querySelector('input[name="dadosConsulta.dtInicio"]');
      const dtFim = document.querySelector('input[name="dadosConsulta.dtFim"]');
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.value = dateValue;
      }
      if (dtFim) {
        dtFim.removeAttribute('readonly');
        dtFim.value = dateValue;
      }
    }, dateBR);
    console.log(`[TJSP] ✅ Datas configuradas`);
    
    // Seleciona todos os cadernos
    console.log(`[TJSP] 📚 Selecionando todos os cadernos...`);
    await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
    console.log(`[TJSP] ✅ Caderno: Todos (-11)`);
    
    // Aguarda um segundo antes de submeter
    await page.waitForTimeout(1000);
    
    // Clica no botão de pesquisa
    console.log(`[TJSP] 🔍 Submetendo busca...`);
    const submitSelectors = [
      'input[type="submit"][value="Pesquisar"]',
      'input[type="submit"]',
      'button[type="submit"]',
      '.btn-pesquisar',
      '#pesquisar'
    ];
    
    for (const selector of submitSelectors) {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        console.log(`[TJSP] ✅ Clicou em: ${selector}`);
        break;
      }
    }
    
    // Aguarda resultados
    console.log(`[TJSP] ⏳ Aguardando resultados...`);
    await page.waitForTimeout(5000);
    
    // Extrai publicações
    console.log(`[TJSP] 📄 Extraindo publicações...`);
    
    const pageContent = await page.content();
    const pageText = await page.evaluate(() => document.body.innerText);
    
    console.log(`[TJSP] 📊 Tamanho do HTML: ${pageContent.length} chars`);
    console.log(`[TJSP] 📊 Tamanho do texto: ${pageText.length} chars`);
    
    // Extrai publicações usando múltiplos seletores
    const publications = await page.evaluate(() => {
      const results = [];
      
      // Seletores expandidos
      const selectors = [
        '.fundocinza1', '.fundocinza2',
        '.resultadoPublicacao', '.publicacao',
        'tr.linha_publicacao td',
        '.conteudoPublicacao', '.textoPublicacao',
        'div[class*="publicacao"]', 'div[class*="resultado"]',
        '.corpo_publicacao', '.texto_publicacao',
        'table.resultados tr', '.listagem tr',
        'article', '.card-publicacao'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 50) {
            results.push({
              text: text,
              date: new Date().toISOString().split('T')[0],
              selector: selector
            });
          }
        });
      }
      
      // Fallback: procura por padrões de texto
      if (results.length === 0) {
        const allText = document.body.innerText;
        const patterns = [
          /Processo[:\s]+\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}[\s\S]{50,2000}?(?=Processo[:\s]+\d{7}|$)/gi,
          /INTIMAÇÃO[\s\S]{50,2000}?(?=INTIMAÇÃO|CITAÇÃO|$)/gi
        ];
        
        for (const pattern of patterns) {
          const matches = allText.match(pattern);
          if (matches) {
            matches.forEach(match => {
              results.push({
                text: match.trim(),
                date: new Date().toISOString().split('T')[0],
                selector: 'regex-fallback'
              });
            });
          }
        }
      }
      
      return results;
    });
    
    console.log(`[TJSP] 📊 Publicações brutas extraídas: ${publications.length}`);
    
    // Filtra publicações válidas usando validação RELAXADA
    const validPublications = publications.filter(pub => isValidPublication(pub.text));
    
    console.log(`[TJSP] 📊 Total de publicações VÁLIDAS: ${validPublications.length}`);
    
    await browser.close();
    console.log(`[TJSP] 🔒 Browser fechado`);
    
    return validPublications.map(pub => ({
      text: pub.text,
      date: target_date,
      process_number: extractProcessNumber(pub.text),
      publication_type: detectPublicationType(pub.text),
      urgency: detectUrgency(pub.text),
      source: 'TJSP',
      caderno: 'DJe'
    }));
    
  } catch (error) {
    console.error(`[TJSP] ❌ Erro no scraping:`, error.message);
    if (browser) await browser.close();
    return [];
  }
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function extractProcessNumber(text) {
  if (!text) return null;
  const match = text.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
  return match ? match[0] : null;
}

function detectPublicationType(text) {
  if (!text) return 'outros';
  const lower = text.toLowerCase();
  if (lower.includes('intimação') || lower.includes('intimado')) return 'intimacao';
  if (lower.includes('citação') || lower.includes('citado')) return 'citacao';
  if (lower.includes('sentença')) return 'sentenca';
  if (lower.includes('decisão') || lower.includes('despacho')) return 'decisao';
  if (lower.includes('acórdão')) return 'acordao';
  return 'outros';
}

function detectUrgency(text) {
  if (!text) return 'normal';
  const lower = text.toLowerCase();
  if (lower.includes('urgente') || lower.includes('urgência')) return 'high';
  if (lower.includes('prazo de 5') || lower.includes('prazo de 05')) return 'high';
  if (lower.includes('imediato') || lower.includes('24 horas')) return 'critical';
  if (lower.includes('prazo de 15') || lower.includes('prazo de 10')) return 'medium';
  return 'normal';
}

// ============================================================
// ENVIO PARA WEBHOOK
// ============================================================
async function sendToWebhook(job, publications) {
  console.log(`[WORKER] 📤 Enviando ${publications.length} publicações para webhook...`);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        job_id: job.id,
        oab_number: job.oab_number,
        oab_state: job.oab_state,
        lawyer_name: job.lawyer_name,
        target_date: job.target_date,
        monitoring_id: job.monitoring_id,
        user_id: job.user_id,
        publications: publications
      })
    });
    
    const result = await response.json();
    console.log(`[WORKER] ✅ Webhook response:`, JSON.stringify(result));
    return result;
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao enviar webhook:`, error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// BUSCA DE JOBS PENDENTES
// ============================================================
async function fetchPendingJobs() {
  console.log(`[WORKER] 🔍 Buscando jobs pendentes...`);
  console.log(`[WORKER] URL: ${GET_JOBS_URL}`);
  
  try {
    const response = await fetch(GET_JOBS_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    
    console.log(`[WORKER] Response status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[WORKER] ❌ Erro na resposta: ${text}`);
      return [];
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

// ============================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================
async function processJobs() {
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
    
    const publications = await scrapeTJSP(job);
    
    console.log(`[WORKER] 📊 Total de publicações válidas: ${publications.length}`);
    
    await sendToWebhook(job, publications);
  }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
async function main() {
  console.log('************************************************************');
  console.log(`[WORKER] 🚀 DJe Scraper Worker v7.0 - INICIANDO`);
  console.log(`[WORKER] 🕐 Horário: ${new Date().toISOString()}`);
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL.substring(0, 60)}...`);
  console.log(`[WORKER] 🔐 Webhook Secret: ${WEBHOOK_SECRET ? '***configurado***' : '⚠️ NÃO CONFIGURADO'}`);
  console.log('************************************************************');
  
  // Executa imediatamente
  await processJobs();
  
  // Configura execução a cada 5 minutos
  console.log(`[WORKER] ♾️ Configurando execução a cada 5 minutos...`);
  setInterval(processJobs, 5 * 60 * 1000);
}

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('[WORKER] ❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[WORKER] ❌ Uncaught Exception:', error);
});

// Inicia o worker
main().catch(error => {
  console.error('[WORKER] ❌ Erro fatal:', error);
  process.exit(1);
});
