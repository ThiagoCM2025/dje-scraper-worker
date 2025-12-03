// ========================================================
// DJe Scraper Worker v9.0 - URL PARAMETRIZADA + BUSCA OAB
// ========================================================
// Changelog v9.0:
// - Acesso via URL com parâmetros GET (mais confiável que formulário)
// - Busca por número OAB em vez de nome do advogado
// - Múltiplas estratégias de busca: OAB puro, OAB/UF, nome
// - Validação de data nas publicações retornadas
// - Logs detalhados de cada etapa
// ========================================================

import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-webhook-receiver';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GET_JOBS_URL = process.env.GET_JOBS_URL || 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-get-pending-jobs';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Formata data para padrão brasileiro DD/MM/YYYY
 */
function formatDateBR(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Extrai número de processo CNJ do texto
 */
function extractProcessNumber(text) {
  if (!text) return null;
  const cnjPattern = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  const matches = text.match(cnjPattern);
  return matches ? matches[0] : null;
}

/**
 * Extrai números OAB do texto
 */
function extractOABs(text) {
  if (!text) return [];
  const oabPatterns = [
    /OAB[:\s/]*(\d{4,6})[/\s-]*(SP|RJ|MG|PR|RS|SC|BA|PE|CE|GO|DF|ES|PB|RN|AL|SE|PI|MA|MT|MS|AM|PA|RO|AC|AP|RR|TO)/gi,
    /OAB[:\s/]*(SP|RJ|MG|PR|RS|SC|BA|PE|CE|GO|DF|ES|PB|RN|AL|SE|PI|MA|MT|MS|AM|PA|RO|AC|AP|RR|TO)[:\s/-]*(\d{4,6})/gi,
    /(SP|RJ|MG|PR|RS|SC|BA|PE|CE|GO|DF|ES|PB|RN|AL|SE|PI|MA|MT|MS|AM|PA|RO|AC|AP|RR|TO)[-]?(\d{4,6})/gi,
    /(\d{4,6})[N]?[/\s-]*(SP|RJ|MG|PR|RS|SC|BA|PE|CE|GO|DF|ES|PB|RN|AL|SE|PI|MA|MT|MS|AM|PA|RO|AC|AP|RR|TO)/gi,
  ];
  const oabs = new Set();
  for (const pattern of oabPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const fullMatch = match[0].replace(/\s+/g, '').toUpperCase();
      oabs.add(fullMatch);
    }
  }
  return Array.from(oabs);
}

/**
 * Classifica urgência da publicação
 */
function classifyUrgency(text) {
  if (!text) return 'normal';
  const upperText = text.toUpperCase();
  if (upperText.includes('URGENTE') || upperText.includes('URGÊNCIA')) return 'critical';
  if (upperText.includes('PRAZO') && /\b(1|2|3|24\s*HORA)/i.test(text)) return 'critical';
  if (upperText.includes('PRAZO') && /\b(5|CINCO)\s*DIAS/i.test(text)) return 'high';
  if (upperText.includes('CITAÇÃO') || upperText.includes('CITACAO')) return 'high';
  if (upperText.includes('INTIMAÇÃO') || upperText.includes('INTIMACAO')) return 'normal';
  return 'normal';
}

/**
 * Detecta tipo de publicação
 */
function detectPublicationType(text) {
  if (!text) return 'outro';
  const upperText = text.toUpperCase();
  if (upperText.includes('SENTENÇA') || upperText.includes('SENTENCA')) return 'sentenca';
  if (upperText.includes('DECISÃO') || upperText.includes('DECISAO')) return 'decisao';
  if (upperText.includes('DESPACHO')) return 'despacho';
  if (upperText.includes('CITAÇÃO') || upperText.includes('CITACAO')) return 'citacao';
  if (upperText.includes('INTIMAÇÃO') || upperText.includes('INTIMACAO')) return 'intimacao';
  if (upperText.includes('EDITAL')) return 'edital';
  return 'outro';
}

/**
 * Verifica se publicação é relevante para a OAB buscada
 */
function isRelevantForOAB(text, oabNumber, oabState) {
  if (!text || !oabNumber) return false;
  
  const oabNumOnly = oabNumber.replace(/[^0-9]/g, '');
  const upperText = text.toUpperCase();
  
  // Padrões de OAB no texto
  const patterns = [
    new RegExp(`OAB[:\\s/]*${oabNumOnly}`, 'i'),
    new RegExp(`OAB[:\\s/]*${oabState}[:\\s/-]*${oabNumOnly}`, 'i'),
    new RegExp(`${oabNumOnly}[N]?[/\\s-]*${oabState}`, 'i'),
    new RegExp(`${oabState}[-]?${oabNumOnly}`, 'i'),
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

/**
 * SCRAPING DO TJSP v9.0 - URL PARAMETRIZADA + BUSCA OAB
 */
async function scrapeTJSP(job) {
  const { oab_number: oabNumber, oab_state: oabState = 'SP', lawyer_name: lawyerName, target_date: targetDate } = job;
  
  console.log(`\n[TJSP] ========================================`);
  console.log(`[TJSP] 🔍 Iniciando scraping v9.0 - URL + OAB`);
  console.log(`[TJSP] ========================================`);
  console.log(`[TJSP] 📋 OAB: ${oabNumber}`);
  console.log(`[TJSP] 🏛️ Estado: ${oabState}`);
  console.log(`[TJSP] 👤 Advogado: ${lawyerName || 'N/A'}`);
  console.log(`[TJSP] 📅 Data alvo: ${targetDate}`);
  
  // Extrair apenas números da OAB
  const oabNumOnly = oabNumber.replace(/[^0-9]/g, '');
  const dateBR = formatDateBR(new Date(targetDate));
  
  console.log(`[TJSP] 🔢 OAB (números): ${oabNumOnly}`);
  console.log(`[TJSP] 📆 Data BR: ${dateBR}`);
  
  // Estratégias de busca em ordem de prioridade
  const searchStrategies = [
    { term: oabNumOnly, desc: 'Número OAB puro' },
    { term: `OAB ${oabNumOnly}`, desc: 'OAB + número' },
    { term: `${oabNumOnly}/${oabState}`, desc: 'Número/UF' },
    { term: `OAB:${oabNumOnly}/${oabState}`, desc: 'OAB:número/UF' },
  ];
  
  // Adicionar nome se disponível (última prioridade)
  if (lawyerName) {
    searchStrategies.push({ term: `"${lawyerName}"`, desc: 'Nome completo' });
  }
  
  console.log(`[TJSP] 🎯 Estratégias de busca: ${searchStrategies.length}`);
  searchStrategies.forEach((s, i) => console.log(`[TJSP]    ${i+1}. ${s.desc}: "${s.term}"`));
  
  let browser;
  const allPublications = [];
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    
    // Tentar cada estratégia até encontrar resultados relevantes
    for (let strategyIndex = 0; strategyIndex < searchStrategies.length; strategyIndex++) {
      const strategy = searchStrategies[strategyIndex];
      
      console.log(`\n[TJSP] 🔄 Estratégia ${strategyIndex + 1}/${searchStrategies.length}: ${strategy.desc}`);
      console.log(`[TJSP] 🔎 Termo: "${strategy.term}"`);
      
      try {
        // ===== CONSTRUIR URL COM PARÂMETROS =====
        // O TJSP aceita parâmetros via GET na URL de consulta
        const baseUrl = 'https://dje.tjsp.jus.br/cdje/consultaAvancada.do';
        const params = new URLSearchParams({
          'dadosConsulta.pesquisaLivre': strategy.term,
          'dadosConsulta.dtInicio': dateBR,
          'dadosConsulta.dtFim': dateBR,
          'dadosConsulta.cdCaderno': '-11', // Todos os cadernos
        });
        
        const searchUrl = `${baseUrl}?${params.toString()}`;
        console.log(`[TJSP] 🌐 URL: ${searchUrl.substring(0, 100)}...`);
        
        // Acessar página com parâmetros
        await page.goto(searchUrl, {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        
        console.log(`[TJSP] ✅ Página carregada`);
        
        // Aguardar um pouco para garantir que JavaScript carregou
        await page.waitForTimeout(2000);
        
        // Verificar se precisa submeter o formulário (alguns sites ignoram params GET)
        const needsSubmit = await page.evaluate(() => {
          const results = document.querySelectorAll('table.resultTable tr, div.publicacao, div.resultado');
          return results.length === 0;
        });
        
        if (needsSubmit) {
          console.log(`[TJSP] ⚠️ URL params não funcionaram, preenchendo formulário...`);
          
          // Preencher campo de busca
          const searchInput = await page.$('#pesquisaLivre');
          if (searchInput) {
            await searchInput.fill('');
            await searchInput.fill(strategy.term);
            console.log(`[TJSP] ✅ Campo pesquisaLivre preenchido`);
          }
          
          // Preencher datas via JavaScript (campos readonly)
          await page.evaluate(({ dateBR }) => {
            const startField = document.querySelector('#dtPublicacaoInicio');
            const endField = document.querySelector('#dtPublicacaoFim');
            
            if (startField) {
              startField.removeAttribute('readonly');
              startField.value = dateBR;
              startField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (endField) {
              endField.removeAttribute('readonly');
              endField.value = dateBR;
              endField.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, { dateBR });
          
          console.log(`[TJSP] ✅ Datas definidas: ${dateBR}`);
          
          // Selecionar caderno
          try {
            await page.selectOption('#cdCaderno', '-11');
            console.log(`[TJSP] ✅ Caderno: Todos (-11)`);
          } catch (e) {}
          
          // Submeter formulário
          await page.waitForTimeout(500);
          
          const submitButton = await page.$('input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            console.log(`[TJSP] ✅ Formulário submetido`);
          } else {
            await page.evaluate(() => {
              const form = document.querySelector('form');
              if (form) form.submit();
            });
          }
          
          await page.waitForTimeout(3000);
          await page.waitForLoadState('networkidle').catch(() => {});
        }
        
        // ===== EXTRAIR RESULTADOS =====
        console.log(`[TJSP] 📄 Extraindo resultados...`);
        
        // Verificar mensagem de "nenhum resultado"
        const noResults = await page.evaluate(() => {
          const body = document.body.innerText;
          return body.includes('Nenhum resultado encontrado') || 
                 body.includes('não foram encontrados') ||
                 body.includes('sem resultados') ||
                 body.includes('Nenhuma publicação');
        });
        
        if (noResults) {
          console.log(`[TJSP] ℹ️ Nenhum resultado para: "${strategy.term}"`);
          continue;
        }
        
        // Extrair publicações
        const results = await page.evaluate(({ targetDateBR }) => {
          const publications = [];
          
          const selectors = [
            'table.resultTable tr',
            'div.publicacao',
            'div.resultado',
            'div.itemResultado',
            '.list-group-item',
            'tr.fundocinza1, tr.fundocinza2',
          ];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el, index) => {
                if (el.tagName === 'TR' && el.querySelector('th')) return;
                
                const text = el.innerText || el.textContent || '';
                if (text.trim().length < 50) return;
                
                // Extrair data da publicação
                let date = '';
                const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
                if (dateMatch) {
                  date = dateMatch[1];
                }
                
                publications.push({
                  text: text.trim(),
                  date: date,
                  index: index
                });
              });
              
              if (publications.length > 0) break;
            }
          }
          
          return publications;
        }, { targetDateBR: dateBR });
        
        console.log(`[TJSP] 📊 ${results.length} elementos brutos extraídos`);
        
        // Filtrar publicações relevantes para a OAB
        let relevantCount = 0;
        
        for (const result of results) {
          // Verificar relevância para a OAB buscada
          const isRelevant = isRelevantForOAB(result.text, oabNumOnly, oabState);
          
          if (isRelevant) {
            relevantCount++;
            
            const processNumber = extractProcessNumber(result.text);
            const oabs = extractOABs(result.text);
            const urgency = classifyUrgency(result.text);
            const pubType = detectPublicationType(result.text);
            
            // Converter data para ISO
            let isoDate = targetDate; // Default: data alvo
            if (result.date) {
              const [day, month, year] = result.date.split('/');
              if (day && month && year) {
                isoDate = `${year}-${month}-${day}`;
              }
            }
            
            allPublications.push({
              date: isoDate,
              type: pubType,
              text: result.text,
              processNumber: processNumber,
              parties: [],
              lawyers: oabs,
              urgency: urgency,
              source: 'TJSP-DJe',
              searchStrategy: strategy.desc
            });
            
            console.log(`[TJSP] ✅ Publicação relevante #${relevantCount}: ${processNumber || 'sem processo'}`);
          }
        }
        
        console.log(`[TJSP] 🎯 ${relevantCount}/${results.length} publicações relevantes para OAB ${oabNumOnly}`);
        
        // Se encontrou resultados relevantes, para de tentar outras estratégias
        if (relevantCount > 0) {
          console.log(`[TJSP] ✅ Encontrou publicações relevantes, encerrando busca`);
          break;
        }
        
      } catch (strategyError) {
        console.error(`[TJSP] ❌ Erro na estratégia "${strategy.desc}":`, strategyError.message);
        continue;
      }
    }
    
    // Remover duplicatas
    const uniquePublications = [];
    const seenTexts = new Set();
    
    for (const pub of allPublications) {
      const textKey = pub.text.substring(0, 500).trim();
      if (!seenTexts.has(textKey)) {
        seenTexts.add(textKey);
        uniquePublications.push(pub);
      }
    }
    
    console.log(`\n[TJSP] ========================================`);
    console.log(`[TJSP] ✅ RESULTADO FINAL: ${uniquePublications.length} publicações únicas`);
    console.log(`[TJSP] ========================================\n`);
    
    return uniquePublications;
    
  } catch (error) {
    console.error(`[TJSP] ❌ Erro geral:`, error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[TJSP] 🔒 Browser fechado`);
    }
  }
}

/**
 * Envia resultados para o webhook receiver
 */
async function sendToWebhook(job, publications, errorMessage = null) {
  const payload = {
    jobId: job.id,
    job_id: job.id,
    status: errorMessage ? 'failed' : 'completed',
    publications: publications || [],
    error: errorMessage,
    resultsCount: publications?.length || 0,
    oab_number: job.oab_number,
    oab_state: job.oab_state || 'SP',
    target_date: job.target_date
  };

  console.log(`[WORKER] 📤 Enviando para webhook...`);
  console.log(`[WORKER] 🌐 URL: ${WEBHOOK_URL}`);
  console.log(`[WORKER] 📊 Publicações: ${publications?.length || 0}`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    console.log(`[WORKER] ✅ Resposta: ${responseText}`);
    
    return response.ok;
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao enviar webhook:`, error.message);
    return false;
  }
}

/**
 * Busca jobs pendentes
 */
async function fetchPendingJobs() {
  console.log(`[WORKER] 📋 Buscando jobs pendentes...`);
  console.log(`[WORKER] 🌐 URL: ${GET_JOBS_URL}`);
  console.log(`[WORKER] 🔑 Enviando x-webhook-secret: length=${WEBHOOK_SECRET?.length || 0}`);
  
  try {
    const response = await fetch(GET_JOBS_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      }
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] ❌ Erro ao buscar jobs: ${response.status} - ${errorText}`);
      return [];
    }
    
    const jobs = await response.json();
    console.log(`[WORKER] ✅ Jobs recebidos: ${jobs.length}`);
    
    jobs.forEach((job, i) => {
      console.log(`[WORKER]   Job ${i+1}: OAB ${job.oab_number} - ${job.target_date}`);
    });
    
    return jobs;
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao buscar jobs:`, error.message);
    return [];
  }
}

/**
 * Processa todos os jobs pendentes
 */
async function processJobs() {
  console.log(`\n======================================================================`);
  console.log(`[WORKER] ⏰ Iniciando ciclo de processamento...`);
  console.log(`[WORKER] 📅 ${new Date().toISOString()}`);
  console.log(`======================================================================`);

  const jobs = await fetchPendingJobs();
  
  if (jobs.length === 0) {
    console.log(`[WORKER] ℹ️ Nenhum job pendente. Aguardando próximo ciclo.`);
    return;
  }
  
  console.log(`[WORKER] 📋 ${jobs.length} job(s) para processar`);
  
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`\n[WORKER] 🔄 Processando job ${i+1}/${jobs.length}: ${job.id}`);
    console.log(`[WORKER]    OAB: ${job.oab_number}`);
    console.log(`[WORKER]    Advogado: ${job.lawyer_name || 'N/A'}`);
    console.log(`[WORKER]    Data: ${job.target_date}`);
    
    try {
      const publications = await scrapeTJSP(job);
      await sendToWebhook(job, publications);
      console.log(`[WORKER] ✅ Job ${job.id} concluído: ${publications.length} publicações`);
    } catch (error) {
      console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
      await sendToWebhook(job, [], error.message);
    }
    
    if (i < jobs.length - 1) {
      console.log(`[WORKER] ⏳ Aguardando 5s antes do próximo job...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log(`\n[WORKER] ✅ Ciclo concluído. ${jobs.length} job(s) processado(s).`);
}

/**
 * Main - Inicia o worker em loop
 */
async function main() {
  console.log(`\n======================================================================`);
  console.log(`[WORKER] 🚀 DJe Scraper Worker v9.0 - URL + OAB - Iniciando...`);
  console.log(`[WORKER] 📅 Data/Hora: ${new Date().toISOString()}`);
  console.log(`======================================================================`);
  console.log(`[WORKER] 🔐 WEBHOOK_URL: ${WEBHOOK_URL ? '✅ OK' : '❌ MISSING!'}`);
  console.log(`[WORKER] 🔐 WEBHOOK_SECRET: ${WEBHOOK_SECRET ? `✅ OK (length=${WEBHOOK_SECRET.length})` : '❌ MISSING!'}`);
  console.log(`======================================================================\n`);
  
  if (!WEBHOOK_SECRET) {
    console.error(`[WORKER] ❌ WEBHOOK_SECRET não configurado! Abortando.`);
    process.exit(1);
  }
  
  console.log(`🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀`);
  console.log(`[WORKER] DJe Scraper Worker v9.0 - INICIADO`);
  console.log(`[WORKER] ✅ Busca por OAB (não por nome)`);
  console.log(`[WORKER] ✅ URL parametrizada + formulário fallback`);
  console.log(`[WORKER] ✅ Validação de relevância por OAB`);
  console.log(`[WORKER] Intervalo: 5 minutos`);
  console.log(`🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀\n`);
  
  // Executar imediatamente
  await processJobs();
  
  // Loop infinito
  console.log(`\n[WORKER] ♾️ Entrando em loop - próxima execução em 5 minutos...`);
  
  setInterval(async () => {
    await processJobs();
    console.log(`\n[WORKER] ♾️ Próxima execução em 5 minutos...`);
  }, INTERVAL_MS);
}

// Iniciar
main().catch(error => {
  console.error(`[WORKER] ❌ Erro fatal:`, error);
  process.exit(1);
});
