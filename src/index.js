// ==============================================================================
// DJe Scraper Worker v6.0 - EXTRAÇÃO COMPLETA COM ADVOGADOS
// ==============================================================================
// Correções aplicadas:
// - Extração do texto COMPLETO das publicações (não apenas snippet)
// - Extração de ADVOGADOS mencionados em cada publicação
// - Busca por NOME e por OAB para maior cobertura
// - Envio correto do x-webhook-secret em TODAS as requisições
// - Tratamento de campos readonly nos inputs de data
// ==============================================================================

import { chromium } from 'playwright';

// ============== CONFIGURAÇÃO ==============
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const RECEIVER_URL = WEBHOOK_URL?.replace('dje-get-pending-jobs', 'dje-webhook-receiver');

const PROCESS_INTERVAL = 5 * 60 * 1000; // 5 minutos

// ============== VALIDAÇÃO INICIAL ==============
function validateConfig() {
  console.log('======================================================================');
  console.log('[WORKER] 🚀 DJe Scraper Worker v6.0 - EXTRAÇÃO COMPLETA');
  console.log(`[WORKER] 📅 Data/Hora: ${new Date().toISOString()}`);
  console.log('======================================================================');
  console.log(`[WORKER] 🔐 WEBHOOK_URL: ${WEBHOOK_URL ? '✅ OK' : '❌ MISSING'}`);
  console.log(`[WORKER] 🔐 WEBHOOK_SECRET: ${WEBHOOK_SECRET ? `✅ OK (length=${WEBHOOK_SECRET.length})` : '❌ MISSING'}`);
  console.log(`[WORKER] 🔐 RECEIVER_URL: ${RECEIVER_URL || '❌ MISSING'}`);
  console.log('======================================================================');

  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error('[WORKER] ❌ FATAL: Variáveis de ambiente não configuradas!');
    console.error('[WORKER] Configure WEBHOOK_URL e WEBHOOK_SECRET no Railway');
    process.exit(1);
  }
}

// ============== HELPERS ==============

// Formatar data para DD/MM/YYYY (formato brasileiro)
function formatDateBR(dateStr) {
  const date = new Date(dateStr + 'T12:00:00Z');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// Extrair número CNJ do texto
function extractCNJ(text) {
  if (!text) return null;
  // Padrão CNJ: 0000000-00.0000.0.00.0000
  const cnjPattern = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  const matches = text.match(cnjPattern);
  return matches ? matches[0] : null;
}

// Extrair TODOS os advogados mencionados no texto
function extractLawyers(text) {
  if (!text) return [];
  
  const lawyers = [];
  const seen = new Set();
  
  // Padrões para encontrar advogados e OABs
  const patterns = [
    // "Advogado: Nome - OAB/SP 123456" ou "Advogado: Nome - OAB: SP123456"
    /Advogad[oa][:\s]+([^-\n]+)\s*[-–]\s*OAB[:\s/]*([A-Z]{2})[:\s/-]*(\d+)/gi,
    // "Adv. Nome - OAB 123456/SP"
    /Adv\.?\s*[:\s]+([^-\n]+)\s*[-–]\s*OAB[:\s/]*(\d+)[/\s-]*([A-Z]{2})/gi,
    // "OAB/SP 123456 - Nome"
    /OAB[:\s/]*([A-Z]{2})[:\s/-]*(\d+)\s*[-–]\s*([^,\n]+)/gi,
    // "OAB: 123456/SP" (captura só o número)
    /OAB[:\s]*(\d+)[/\s-]*([A-Z]{2})/gi,
    // "123456/SP" seguido de nome
    /(\d{5,6})[/\s-]*(SP|RJ|MG|RS|PR|SC|BA|PE|CE|GO|DF|ES|MT|MS|PA|AM|MA|PB|RN|PI|SE|AL|TO|RO|AC|AP|RR)\s*[-–]?\s*([A-Z][a-záéíóúãõâêîôûç\s]+)/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let name = '';
      let oabState = '';
      let oabNumber = '';
      
      // Determinar qual grupo tem o que baseado no padrão
      if (match[1] && match[2] && match[3]) {
        // Verificar se o primeiro grupo é nome ou estado
        if (/^[A-Z]{2}$/.test(match[1])) {
          oabState = match[1];
          oabNumber = match[2];
          name = match[3];
        } else if (/^\d+$/.test(match[1])) {
          oabNumber = match[1];
          oabState = match[2];
          name = match[3];
        } else {
          name = match[1];
          oabState = match[2];
          oabNumber = match[3];
        }
      } else if (match[1] && match[2]) {
        if (/^\d+$/.test(match[1])) {
          oabNumber = match[1];
          oabState = match[2];
        } else {
          oabState = match[1];
          oabNumber = match[2];
        }
      }
      
      // Limpar e validar
      name = name?.trim().replace(/\s+/g, ' ') || '';
      oabNumber = oabNumber?.replace(/\D/g, '') || '';
      oabState = oabState?.toUpperCase() || 'SP';
      
      if (oabNumber && oabNumber.length >= 4) {
        const key = `${oabState}${oabNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          lawyers.push({
            name: name || null,
            oab: `${oabNumber}/${oabState}`,
            oabNumber: oabNumber,
            oabState: oabState
          });
        }
      }
    }
  }
  
  return lawyers;
}

// Extrair partes do processo
function extractParties(text) {
  if (!text) return [];
  
  const parties = [];
  
  // Padrões para partes
  const patterns = [
    /(?:Autor|Requerente|Exequente|Impetrante)[:\s]+([^-\n]+)/gi,
    /(?:Réu|Requerido|Executado|Impetrado)[:\s]+([^-\n]+)/gi,
    /(?:Apelante|Recorrente|Agravante)[:\s]+([^-\n]+)/gi,
    /(?:Apelado|Recorrido|Agravado)[:\s]+([^-\n]+)/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const party = match[1]?.trim();
      if (party && party.length > 2 && !parties.includes(party)) {
        parties.push(party);
      }
    }
  }
  
  return parties.slice(0, 10); // Limitar a 10 partes
}

// Detectar tipo de publicação
function detectType(text) {
  if (!text) return 'outros';
  const upper = text.toUpperCase();
  
  if (upper.includes('SENTENÇA')) return 'sentenca';
  if (upper.includes('DECISÃO') || upper.includes('DECISAO')) return 'decisao';
  if (upper.includes('DESPACHO')) return 'despacho';
  if (upper.includes('INTIMAÇÃO') || upper.includes('INTIMACAO') || upper.includes('INTIMA-SE')) return 'intimacao';
  if (upper.includes('CITAÇÃO') || upper.includes('CITACAO') || upper.includes('CITE-SE')) return 'citacao';
  if (upper.includes('ACÓRDÃO') || upper.includes('ACORDAO')) return 'acordao';
  if (upper.includes('EDITAL')) return 'edital';
  
  return 'outros';
}

// Classificar urgência
function classifyUrgency(text) {
  if (!text) return 'normal';
  const upper = text.toUpperCase();
  
  // Crítico: prazos muito curtos
  if (/PRAZO\s*(DE\s*)?\d\s*(DIA|HORA)/i.test(text)) return 'critical';
  if (upper.includes('URGENTE') || upper.includes('URGÊNCIA')) return 'critical';
  if (upper.includes('LIMINAR') || upper.includes('TUTELA DE URGÊNCIA')) return 'critical';
  
  // Alto: sentenças e decisões importantes
  if (upper.includes('SENTENÇA CONDENATÓRIA')) return 'high';
  if (upper.includes('PRAZO DE 5') || upper.includes('PRAZO DE 05')) return 'high';
  if (upper.includes('INTIMAÇÃO PESSOAL')) return 'high';
  
  // Médio: prazos normais
  if (upper.includes('PRAZO DE 15') || upper.includes('PRAZO DE 10')) return 'normal';
  
  return 'normal';
}

// ============== SCRAPING TJSP ==============
async function scrapeTJSP(job) {
  const { oab_number, lawyer_name, target_date } = job;
  
  console.log('[TJSP] 🔍 Iniciando scraping COMPLETO...');
  console.log(`[TJSP] 📋 OAB: ${oab_number}`);
  console.log(`[TJSP] 👤 Advogado: ${lawyer_name || 'N/A'}`);
  
  const dateBR = formatDateBR(target_date);
  console.log(`[TJSP] 📅 Data alvo: ${target_date} → BR: ${dateBR}`);
  
  // Usar nome do advogado como termo de busca (mais preciso)
  const searchTerm = lawyer_name || oab_number;
  console.log(`[TJSP] 🔎 Termo de busca: "${searchTerm}"`);
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });

  const publications = [];
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    
    console.log('[TJSP] 🌐 Acessando DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    console.log('[TJSP] ✅ Página carregada');
    
    // ============== PREENCHER FORMULÁRIO ==============
    console.log('[TJSP] 📝 Preenchendo formulário...');
    
    // Campo de pesquisa livre (nome do advogado ou OAB)
    await page.waitForSelector('#dadosConsulta\\.pesquisaLivre', { state: 'visible', timeout: 15000 });
    await page.fill('#dadosConsulta\\.pesquisaLivre', `"${searchTerm}"`);
    console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    
    // Datas (campos readonly - usar page.evaluate para contornar)
    console.log('[TJSP] 📅 Preenchendo datas (campos readonly)...');
    await page.evaluate((dateValue) => {
      const dtInicio = document.querySelector('#dadosConsulta\\.dtInicio');
      const dtFim = document.querySelector('#dadosConsulta\\.dtFim');
      
      if (dtInicio) {
        dtInicio.removeAttribute('readonly');
        dtInicio.removeAttribute('disabled');
        dtInicio.value = dateValue;
        dtInicio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      if (dtFim) {
        dtFim.removeAttribute('readonly');
        dtFim.removeAttribute('disabled');
        dtFim.value = dateValue;
        dtFim.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, dateBR);
    console.log(`[TJSP] ✅ Datas definidas: ${dateBR}`);
    
    // Selecionar caderno "Todos"
    try {
      await page.selectOption('#dadosConsulta\\.cdCaderno', '-11');
      console.log('[TJSP] ✅ Caderno: Todos (-11)');
    } catch (e) {
      console.log('[TJSP] ⚠️ Caderno não selecionado (pode não existir)');
    }
    
    // Aguardar um pouco antes de submeter
    await page.waitForTimeout(1000);
    
    // ============== SUBMETER BUSCA ==============
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    // Tentar diferentes seletores para o botão de submit
    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      '#pbEnviar',
      'input[value="Pesquisar"]',
      'button:has-text("Pesquisar")'
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
        // Tentar próximo seletor
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
    
    // Aguardar resultados
    await page.waitForTimeout(5000);
    
    // ============== EXTRAIR RESULTADOS COMPLETOS ==============
    console.log('[TJSP] 📄 Extraindo resultados COMPLETOS...');
    
    // Verificar se há resultados
    const pageContent = await page.content();
    const noResults = pageContent.includes('Nenhum resultado encontrado') || 
                      pageContent.includes('Não foram encontrados') ||
                      pageContent.includes('0 resultado');
    
    if (noResults) {
      console.log('[TJSP] ⚠️ Nenhum resultado encontrado para esta busca');
      await browser.close();
      return [];
    }
    
    // Extrair TODOS os elementos de resultado com TEXTO COMPLETO
    const rawResults = await page.evaluate(() => {
      const results = [];
      
      // Múltiplos seletores para capturar resultados
      const selectors = [
        '.fundocinza1', // Container principal de cada resultado
        '.divResultado',
        '.resultadoPesquisa',
        'tr.fundocinza1',
        'tr.fundocinza2',
        'div[id^="divDetalhes"]', // Detalhes expandidos
        '.conteudo-publicacao',
        '.texto-publicacao'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Capturar TEXTO COMPLETO do elemento (não apenas snippet)
          let fullText = el.innerText || el.textContent || '';
          
          // Tentar expandir/capturar conteúdo oculto
          const hiddenContent = el.querySelector('.conteudo, .detalhes, .inteiro-teor, [style*="display: none"]');
          if (hiddenContent) {
            fullText += ' ' + (hiddenContent.innerText || hiddenContent.textContent || '');
          }
          
          // Capturar links de "Ver inteiro teor" se existirem
          const links = el.querySelectorAll('a');
          for (const link of links) {
            if (link.href && link.href.includes('consultaSimples')) {
              fullText += ` [Link: ${link.href}]`;
            }
          }
          
          // Limpar e adicionar se tiver conteúdo substancial
          fullText = fullText.replace(/\s+/g, ' ').trim();
          if (fullText.length > 50) {
            results.push({
              text: fullText,
              html: el.outerHTML.substring(0, 5000) // Para debug
            });
          }
        }
      }
      
      return results;
    });
    
    console.log(`[TJSP] 📊 ${rawResults.length} elementos brutos extraídos`);
    
    // Log de amostra para debug
    if (rawResults.length > 0) {
      console.log(`[TJSP] 📝 Amostra do 1º resultado (500 chars): ${rawResults[0].text.substring(0, 500)}...`);
    }
    
    // Processar cada resultado
    for (const raw of rawResults) {
      const text = raw.text;
      
      // Extrair dados estruturados
      const processNumber = extractCNJ(text);
      const lawyers = extractLawyers(text);
      const parties = extractParties(text);
      const type = detectType(text);
      const urgency = classifyUrgency(text);
      
      // Log dos advogados encontrados
      if (lawyers.length > 0) {
        console.log(`[TJSP] 👨‍⚖️ Advogados encontrados: ${lawyers.map(l => l.oab).join(', ')}`);
      }
      
      publications.push({
        date: target_date,
        type: type,
        text: text, // TEXTO COMPLETO
        processNumber: processNumber,
        parties: parties,
        lawyers: lawyers.map(l => `${l.name || 'N/A'} - OAB ${l.oab}`),
        lawyersData: lawyers, // Dados estruturados para validação
        urgency: urgency,
        source: 'TJSP'
      });
    }
    
    console.log(`[TJSP] ✅ ${publications.length} publicações processadas`);
    
    // Deduplicar por número de processo
    const seen = new Set();
    const uniquePublications = publications.filter(pub => {
      const key = pub.processNumber || pub.text.substring(0, 200);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    console.log(`[TJSP] 🔄 Após deduplicação: ${uniquePublications.length} publicações únicas`);
    
    await browser.close();
    console.log('[TJSP] 🔒 Browser fechado');
    
    return uniquePublications;
    
  } catch (error) {
    console.error('[TJSP] ❌ Erro no scraping:', error.message);
    try {
      await browser.close();
    } catch (e) {}
    return [];
  }
}

// ============== BUSCAR JOBS PENDENTES ==============
async function getPendingJobs() {
  console.log('[WORKER] 📋 Buscando jobs pendentes...');
  console.log(`[WORKER] 🌐 URL: ${WEBHOOK_URL}`);
  console.log(`[WORKER] 🔑 Enviando x-webhook-secret: length=${WEBHOOK_SECRET?.length || 0}`);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      }
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] ❌ Erro HTTP ${response.status}: ${errorText}`);
      return [];
    }
    
    const data = await response.json();
    const jobs = data.jobs || data || [];
    
    console.log(`[WORKER] ✅ Jobs recebidos: ${Array.isArray(jobs) ? jobs.length : 0}`);
    
    if (Array.isArray(jobs) && jobs.length > 0) {
      jobs.forEach((job, idx) => {
        console.log(`[WORKER]   Job ${idx + 1}: OAB ${job.oab_number} - ${job.target_date}`);
      });
    }
    
    return Array.isArray(jobs) ? jobs : [];
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro ao buscar jobs:', error.message);
    return [];
  }
}

// ============== ENVIAR RESULTADOS ==============
async function sendResults(job, publications, error = null) {
  console.log(`[WORKER] 📤 Enviando resultados do job ${job.id}...`);
  console.log(`[WORKER] 🌐 Receiver URL: ${RECEIVER_URL}`);
  console.log(`[WORKER] 🔑 Enviando x-webhook-secret: length=${WEBHOOK_SECRET?.length || 0}`);
  
  const payload = {
    jobId: job.id,
    job_id: job.id, // Redundância para compatibilidade
    status: error ? 'failed' : 'completed',
    publications: publications || [],
    resultsCount: publications?.length || 0,
    error: error || null,
    oab_number: job.oab_number,
    target_date: job.target_date,
    cleanAfterProcess: false // Manter job para auditoria
  };
  
  try {
    const response = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });
    
    console.log(`[WORKER] 📨 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] ❌ Erro ao enviar: ${response.status} - ${errorText}`);
      return false;
    }
    
    const result = await response.json();
    console.log(`[WORKER] ✅ Resultados enviados: ${JSON.stringify(result)}`);
    return true;
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro ao enviar resultados:', error.message);
    return false;
  }
}

// ============== PROCESSAR JOBS ==============
async function processJobs() {
  console.log('');
  console.log('======================================================================');
  console.log('[WORKER] ⏰ Iniciando ciclo de processamento...');
  console.log(`[WORKER] 📅 ${new Date().toISOString()}`);
  console.log('======================================================================');
  
  // Buscar jobs pendentes
  const jobs = await getPendingJobs();
  
  if (!jobs || jobs.length === 0) {
    console.log('[WORKER] 💤 Nenhum job pendente');
    return;
  }
  
  console.log(`[WORKER] 📋 ${jobs.length} job(s) para processar`);
  
  // Processar cada job sequencialmente
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    
    console.log('');
    console.log(`[WORKER] 🔄 Processando job ${i + 1}/${jobs.length}: ${job.id}`);
    console.log(`[WORKER]    OAB: ${job.oab_number}`);
    console.log(`[WORKER]    Advogado: ${job.lawyer_name || 'N/A'}`);
    console.log(`[WORKER]    Data: ${job.target_date}`);
    
    try {
      // Executar scraping baseado no tribunal
      let publications = [];
      
      const tribunal = (job.tribunal || 'TJSP').toUpperCase();
      
      switch (tribunal) {
        case 'TJSP':
          publications = await scrapeTJSP(job);
          break;
        // TODO: Adicionar outros tribunais
        // case 'TJRJ':
        //   publications = await scrapeTJRJ(job);
        //   break;
        default:
          console.log(`[WORKER] ⚠️ Tribunal ${tribunal} não suportado ainda`);
          publications = [];
      }
      
      console.log(`[WORKER] 📊 Scraping concluído: ${publications.length} publicações encontradas`);
      
      // Enviar resultados
      await sendResults(job, publications);
      
      console.log(`[WORKER] ✅ Job ${job.id} concluído: ${publications.length} publicações`);
      
    } catch (error) {
      console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
      await sendResults(job, [], error.message);
    }
    
    // Delay entre jobs para não sobrecarregar
    if (i < jobs.length - 1) {
      console.log('[WORKER] ⏳ Aguardando 5s antes do próximo job...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log('');
  console.log(`[WORKER] ✅ Ciclo concluído. ${jobs.length} job(s) processado(s).`);
}

// ============== MAIN ==============
async function main() {
  // Validar configuração
  validateConfig();
  
  console.log('');
  console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
  console.log('[WORKER] DJe Scraper Worker v6.0 - INICIADO');
  console.log('[WORKER] Intervalo: 5 minutos');
  console.log('[WORKER] Recursos: Extração completa com advogados');
  console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
  console.log('');
  
  // Executar imediatamente na inicialização
  await processJobs();
  
  // Loop infinito com intervalo
  console.log('');
  console.log(`[WORKER] ♾️ Entrando em loop - próxima execução em 5 minutos...`);
  
  setInterval(async () => {
    try {
      await processJobs();
      console.log('');
      console.log(`[WORKER] ♾️ Próxima execução em 5 minutos...`);
    } catch (error) {
      console.error('[WORKER] ❌ Erro no ciclo:', error.message);
    }
  }, PROCESS_INTERVAL);
}

// Tratamento de sinais para shutdown graceful
process.on('SIGTERM', () => {
  console.log('[WORKER] 🛑 SIGTERM recebido - encerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[WORKER] 🛑 SIGINT recebido - encerrando...');
  process.exit(0);
});

// Iniciar worker
main().catch(error => {
  console.error('[WORKER] ❌ Erro fatal:', error);
  process.exit(1);
});
