// ========================================================
// DJe Scraper Worker v8.0 - CORREÇÃO DEFINITIVA DE DATAS
// ========================================================
// Changelog v8.0:
// - Verificação de datas APÓS preenchimento
// - Método mais robusto para campos readonly (evaluate + dispatchEvent)
// - Busca por OAB + Nome (ambos para maior cobertura)
// - Intervalo de 3 dias de busca para garantir cobertura
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
 * Gera array de datas para busca (últimos N dias)
 */
function getDateRange(targetDate, daysBefore = 2) {
  const dates = [];
  const target = new Date(targetDate);
  
  for (let i = daysBefore; i >= 0; i--) {
    const d = new Date(target);
    d.setDate(d.getDate() - i);
    dates.push(formatDateBR(d));
  }
  
  return dates;
}

/**
 * Extrai número de processo CNJ do texto
 */
function extractProcessNumber(text) {
  if (!text) return null;
  
  // Padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
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
 * SCRAPING DO TJSP - VERSÃO 8.0 COM CORREÇÃO DE DATAS
 */
async function scrapeTJSP(job) {
  const { oab_number: oabNumber, lawyer_name: lawyerName, target_date: targetDate } = job;
  
  console.log(`[TJSP] 🔍 Iniciando scraping v8.0...`);
  console.log(`[TJSP] 📋 OAB: ${oabNumber}`);
  console.log(`[TJSP] 👤 Advogado: ${lawyerName || 'N/A'}`);
  console.log(`[TJSP] 📅 Data alvo: ${targetDate}`);
  
  // Extrair apenas números da OAB
  const oabNumOnly = oabNumber.replace(/[^0-9]/g, '');
  
  // Gerar intervalo de datas (3 dias: target e 2 anteriores)
  const dateRange = getDateRange(targetDate, 2);
  console.log(`[TJSP] 📆 Intervalo de busca: ${dateRange.join(' | ')}`);
  
  // Data formatada para busca (usar a mais recente)
  const dateBR = formatDateBR(new Date(targetDate));
  const dateStartBR = dateRange[0]; // Data mais antiga (2 dias antes)
  const dateEndBR = dateRange[dateRange.length - 1]; // Data alvo
  
  console.log(`[TJSP] 📅 Período: ${dateStartBR} até ${dateEndBR}`);
  
  // ESTRATÉGIA DE BUSCA: OAB direta (mais precisa) + Nome completo
  // Usar busca por OAB é mais precisa que por nome
  const searchTerms = [
    oabNumOnly,  // Apenas número da OAB
    `"${oabNumOnly}"`, // Número exato
    lawyerName ? `"${lawyerName}"` : null // Nome completo entre aspas
  ].filter(Boolean);
  
  console.log(`[TJSP] 🔎 Termos de busca: ${searchTerms.join(' | ')}`);
  
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
    
    // Para cada termo de busca
    for (const searchTerm of searchTerms) {
      console.log(`\n[TJSP] 🔍 Buscando com termo: ${searchTerm}`);
      
      try {
        // Acessar página de consulta avançada
        console.log(`[TJSP] 🌐 Acessando DJe TJSP...`);
        await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        console.log(`[TJSP] ✅ Página carregada`);
        
        // Aguardar formulário estar pronto
        await page.waitForSelector('#pesquisaLivre', { timeout: 10000 });
        await page.waitForTimeout(1000);
        
        // ===== PREENCHER CAMPO DE BUSCA =====
        console.log(`[TJSP] 📝 Preenchendo termo de busca...`);
        await page.fill('#pesquisaLivre', ''); // Limpar
        await page.fill('#pesquisaLivre', searchTerm);
        console.log(`[TJSP] ✅ Campo pesquisaLivre: "${searchTerm}"`);
        
        // ===== PREENCHER DATAS (MÉTODO ROBUSTO) =====
        console.log(`[TJSP] 📅 Preenchendo datas com método robusto...`);
        
        // Usar page.evaluate para manipular campos readonly diretamente no DOM
        const datesApplied = await page.evaluate(({ dateStart, dateEnd }) => {
          const startField = document.querySelector('#dtPublicacaoInicio');
          const endField = document.querySelector('#dtPublicacaoFim');
          
          if (!startField || !endField) {
            return { success: false, error: 'Campos de data não encontrados' };
          }
          
          // Remover readonly temporariamente
          startField.removeAttribute('readonly');
          startField.removeAttribute('disabled');
          endField.removeAttribute('readonly');
          endField.removeAttribute('disabled');
          
          // Limpar valores existentes
          startField.value = '';
          endField.value = '';
          
          // Definir novos valores
          startField.value = dateStart;
          endField.value = dateEnd;
          
          // Disparar todos os eventos necessários
          const events = ['focus', 'input', 'change', 'blur'];
          events.forEach(eventName => {
            startField.dispatchEvent(new Event(eventName, { bubbles: true }));
            endField.dispatchEvent(new Event(eventName, { bubbles: true }));
          });
          
          // Verificar se valores foram aplicados
          return {
            success: true,
            startValue: startField.value,
            endValue: endField.value
          };
        }, { dateStart: dateStartBR, dateEnd: dateEndBR });
        
        console.log(`[TJSP] 📅 Resultado do preenchimento de datas:`, datesApplied);
        
        // ===== VERIFICAR SE DATAS FORAM APLICADAS =====
        const appliedStart = await page.$eval('#dtPublicacaoInicio', el => el.value);
        const appliedEnd = await page.$eval('#dtPublicacaoFim', el => el.value);
        
        console.log(`[TJSP] 🔍 VERIFICAÇÃO - Datas realmente aplicadas:`);
        console.log(`[TJSP]    Data Início: "${appliedStart}" (esperado: "${dateStartBR}")`);
        console.log(`[TJSP]    Data Fim: "${appliedEnd}" (esperado: "${dateEndBR}")`);
        
        if (appliedStart !== dateStartBR || appliedEnd !== dateEndBR) {
          console.error(`[TJSP] ⚠️ AVISO: Datas podem não ter sido aplicadas corretamente!`);
          console.log(`[TJSP] 🔄 Tentando método alternativo com JavaScript...`);
          
          // Método alternativo: definir via JavaScript e forçar
          await page.evaluate(({ dateStart, dateEnd }) => {
            document.querySelector('#dtPublicacaoInicio').setAttribute('value', dateStart);
            document.querySelector('#dtPublicacaoFim').setAttribute('value', dateEnd);
            
            // Forçar via objeto de formulário
            const form = document.querySelector('form');
            if (form) {
              const inputStart = form.querySelector('[name="dadosConsulta.dtInicio"]');
              const inputEnd = form.querySelector('[name="dadosConsulta.dtFim"]');
              if (inputStart) inputStart.value = dateStart;
              if (inputEnd) inputEnd.value = dateEnd;
            }
          }, { dateStart: dateStartBR, dateEnd: dateEndBR });
          
          // Re-verificar
          const finalStart = await page.$eval('#dtPublicacaoInicio', el => el.value);
          const finalEnd = await page.$eval('#dtPublicacaoFim', el => el.value);
          console.log(`[TJSP] 🔍 Após método alternativo: Início="${finalStart}", Fim="${finalEnd}"`);
        }
        
        // ===== SELECIONAR CADERNO (TODOS) =====
        try {
          await page.selectOption('#cdCaderno', '-11'); // -11 = Todos os cadernos
          console.log(`[TJSP] ✅ Caderno: Todos (-11)`);
        } catch (e) {
          console.log(`[TJSP] ⚠️ Não foi possível selecionar caderno: ${e.message}`);
        }
        
        // Aguardar antes de submeter
        await page.waitForTimeout(1000);
        
        // ===== SUBMETER BUSCA =====
        console.log(`[TJSP] 🔍 Submetendo busca...`);
        
        // Tentar diferentes métodos de submissão
        const submitSelectors = [
          'input[type="submit"]',
          'button[type="submit"]',
          '#pbSubmit',
          'input[value="Pesquisar"]'
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
          // Fallback: submeter via JavaScript
          await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) form.submit();
          });
          console.log(`[TJSP] ✅ Formulário submetido via JavaScript`);
        }
        
        // Aguardar resultados carregarem
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle').catch(() => {});
        
        // ===== EXTRAIR RESULTADOS =====
        console.log(`[TJSP] 📄 Extraindo resultados...`);
        
        // Verificar se há mensagem de "nenhum resultado"
        const noResults = await page.evaluate(() => {
          const body = document.body.innerText;
          return body.includes('Nenhum resultado encontrado') || 
                 body.includes('não foram encontrados') ||
                 body.includes('sem resultados');
        });
        
        if (noResults) {
          console.log(`[TJSP] ℹ️ Nenhum resultado encontrado para: ${searchTerm}`);
          continue;
        }
        
        // Extrair publicações
        const results = await page.evaluate(() => {
          const publications = [];
          
          // Seletores para diferentes estruturas de resultado do TJSP
          const selectors = [
            'table.resultTable tr',
            'div.publicacao',
            'div.resultado',
            'div.itemResultado',
            '.list-group-item',
            'tr.fundocinza1, tr.fundocinza2',
            'div[class*="resultado"]',
            'div[class*="publicacao"]'
          ];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              console.log(`Encontrados ${elements.length} elementos com ${selector}`);
              
              elements.forEach((el, index) => {
                // Ignorar headers de tabela
                if (el.tagName === 'TR' && el.querySelector('th')) return;
                
                // Pegar texto completo do elemento
                const text = el.innerText || el.textContent || '';
                
                // Ignorar textos muito curtos
                if (text.trim().length < 50) return;
                
                // Pegar data da publicação se disponível
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
        });
        
        console.log(`[TJSP] 📊 ${results.length} elementos brutos extraídos para termo "${searchTerm}"`);
        
        // Processar resultados
        for (const result of results) {
          const processNumber = extractProcessNumber(result.text);
          const oabs = extractOABs(result.text);
          const urgency = classifyUrgency(result.text);
          const pubType = detectPublicationType(result.text);
          
          // Converter data para formato ISO se disponível
          let isoDate = new Date().toISOString().split('T')[0];
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
            searchTerm: searchTerm // Para debug
          });
        }
        
      } catch (searchError) {
        console.error(`[TJSP] ❌ Erro na busca por "${searchTerm}":`, searchError.message);
        continue;
      }
    }
    
    // Remover duplicatas baseado no texto
    const uniquePublications = [];
    const seenTexts = new Set();
    
    for (const pub of allPublications) {
      const textKey = pub.text.substring(0, 500).trim();
      if (!seenTexts.has(textKey)) {
        seenTexts.add(textKey);
        uniquePublications.push(pub);
      }
    }
    
    console.log(`[TJSP] ✅ Total: ${allPublications.length} brutos → ${uniquePublications.length} únicos`);
    
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
    status: errorMessage ? 'failed' : 'completed',
    publications: publications || [],
    error: errorMessage,
    resultsCount: publications?.length || 0,
    oab_number: job.oab_number,
    target_date: job.target_date
  };

  console.log(`[WORKER] 📤 Enviando para webhook...`);
  console.log(`[WORKER] 🌐 URL: ${WEBHOOK_URL}`);

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
    
    // Aguardar entre jobs para não sobrecarregar
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
  console.log(`[WORKER] 🚀 DJe Scraper Worker v8.0 - Iniciando...`);
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
  console.log(`[WORKER] DJe Scraper Worker v8.0 - INICIADO`);
  console.log(`[WORKER] Intervalo: 5 minutos`);
  console.log(`[WORKER] Estratégia: Busca por OAB + Nome | Período: 3 dias`);
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
