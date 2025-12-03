// src/index.js - Railway Worker v6.0 - EXTRAÇÃO CORRIGIDA
import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function formatDateBR(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

// Hash simples para deduplicação local
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// Validação se publicação é relevante para o advogado
function isRelevantForLawyer(text, oabNumber, lawyerName) {
  if (!text || text.length < 50) return false;
  
  const upperText = text.toUpperCase();
  const oabNumOnly = oabNumber.replace(/[^0-9]/g, '');
  
  // Método 1: OAB no texto (várias formatações)
  const oabPatterns = [
    new RegExp(`OAB[:\\s/]*${oabNumOnly}`, 'i'),
    new RegExp(`OAB[:\\s/]*SP[:\\s/-]*${oabNumOnly}`, 'i'),
    new RegExp(`${oabNumOnly}[/\\s-]*SP`, 'i'),
    new RegExp(`\\b${oabNumOnly}\\b`, 'i'),
  ];
  
  for (const pattern of oabPatterns) {
    if (pattern.test(text)) {
      console.log(`[VALIDATION] ✅ OAB ${oabNumOnly} encontrada no texto`);
      return true;
    }
  }
  
  // Método 2: Nome completo do advogado
  if (lawyerName && lawyerName.length > 5) {
    const normalizedName = lawyerName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    
    const normalizedText = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    if (normalizedText.includes(normalizedName)) {
      console.log(`[VALIDATION] ✅ Nome "${lawyerName}" encontrado no texto`);
      return true;
    }
    
    // Tentar partes do nome (primeiro + último)
    const nameParts = normalizedName.split(/\s+/);
    if (nameParts.length >= 2) {
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      
      if (firstName.length >= 3 && lastName.length >= 3) {
        if (normalizedText.includes(firstName) && normalizedText.includes(lastName)) {
          console.log(`[VALIDATION] ✅ Nome parcial "${firstName} ... ${lastName}" encontrado`);
          return true;
        }
      }
    }
  }
  
  console.log(`[VALIDATION] ❌ Publicação não é relevante para OAB ${oabNumOnly} / ${lawyerName}`);
  return false;
}

async function processJobs() {
  console.log('');
  console.log('='.repeat(60));
  console.log('[WORKER] ⏰ ' + new Date().toISOString() + ' - Processando fila...');
  console.log('='.repeat(60));
  
  try {
    console.log('[WORKER] 🔍 Buscando jobs pendentes...');
    console.log(`[WORKER] URL: ${WEBHOOK_URL}/dje-get-pending-jobs`);
    
    const response = await fetch(`${WEBHOOK_URL}/dje-get-pending-jobs`, {
      method: 'GET',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    });

    console.log(`[WORKER] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WORKER] ❌ Erro ao buscar jobs:', response.status, errorText);
      return;
    }

    const data = await response.json();
    const jobs = data.jobs || [];
    const count = data.count || jobs.length;
    
    console.log(`[WORKER] ✅ ${count} job(s) encontrado(s)`);
    
    if (jobs.length === 0) {
      console.log('[WORKER] ℹ️ Nenhum job pendente. Aguardando próximo ciclo.');
      return;
    }

    for (const job of jobs) {
      console.log('');
      console.log('-'.repeat(50));
      console.log(`[WORKER] 🔄 Processando job: ${job.id}`);
      console.log(`[WORKER] 📋 OAB: ${job.oab_number}/${job.oab_state}`);
      console.log(`[WORKER] 👤 Advogado: ${job.lawyer_name || 'N/A'}`);
      console.log(`[WORKER] 📅 Data: ${job.target_date}`);
      console.log('-'.repeat(50));

      try {
        const publications = await scrapeTJSP(job);
        console.log(`[WORKER] 📊 Total de publicações válidas: ${publications.length}`);
        await sendToWebhook(job, publications);
      } catch (error) {
        console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
        console.error(`[WORKER] Stack:`, error.stack);
        await sendToWebhook(job, [], error.message);
      }
    }

  } catch (error) {
    console.error('[WORKER] ❌ Erro fatal:', error.message);
    console.error('[WORKER] Stack:', error.stack);
  }
}

async function scrapeTJSP(job) {
  console.log('[TJSP] 🚀 Iniciando scraping do DJe TJSP...');
  
  const targetDate = job.target_date;
  const dateBR = formatDateBR(targetDate);
  const searchTerm = job.lawyer_name || `OAB ${job.oab_number}`;
  
  console.log(`[TJSP] 🔍 Termo de busca: "${searchTerm}"`);
  console.log(`[TJSP] 📅 Data alvo: ${targetDate} (BR: ${dateBR})`);

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

  const allPublications = [];
  const seenHashes = new Set();

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    // Navegar para a página de consulta
    console.log('[TJSP] 🌐 Navegando para DJe TJSP...');
    await page.goto('https://dje.tjsp.jus.br/cdje/consultaAvancada.do', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    // Aguardar a página carregar
    await page.waitForTimeout(3000);
    console.log('[TJSP] ✅ Página carregada');

    // Screenshot para debug (opcional)
    // await page.screenshot({ path: '/tmp/tjsp-1-loaded.png' });

    // Verificar se o formulário existe
    const formExists = await page.$('form');
    console.log(`[TJSP] 📝 Formulário encontrado: ${formExists ? 'SIM' : 'NÃO'}`);

    // PASSO 1: Preencher campo de pesquisa livre
    console.log(`[TJSP] 📝 Preenchendo pesquisa livre: "${searchTerm}"`);
    try {
      const pesquisaLivreSelector = 'input[name="dadosConsulta.pesquisaLivre"]';
      await page.waitForSelector(pesquisaLivreSelector, { timeout: 10000 });
      await page.fill(pesquisaLivreSelector, searchTerm);
      console.log('[TJSP] ✅ Campo pesquisaLivre preenchido');
    } catch (e) {
      console.log('[TJSP] ⚠️ Método fill falhou, tentando via JavaScript...');
      await page.evaluate((term) => {
        const el = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
        if (el) {
          el.value = term;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, searchTerm);
    }

    // PASSO 2: Preencher datas (campos readonly - usar JavaScript)
    console.log(`[TJSP] 📅 Preenchendo datas: ${dateBR}`);
    
    await page.evaluate((dateValue) => {
      // Função auxiliar para definir valor em campo readonly
      function setDateField(selector, value) {
        const el = document.querySelector(selector);
        if (el) {
          // Remover atributos que bloqueiam edição
          el.removeAttribute('readonly');
          el.removeAttribute('disabled');
          el.classList.remove('disabled');
          
          // Definir valor
          el.value = value;
          
          // Disparar eventos
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          
          console.log(`Campo ${selector} definido: ${value}`);
          return true;
        }
        return false;
      }
      
      // Tentar diferentes seletores para data início
      const dtInicioSelectors = [
        'input[name="dadosConsulta.dtInicio"]',
        'input#dtInicio',
        'input[id*="dtInicio"]'
      ];
      
      for (const sel of dtInicioSelectors) {
        if (setDateField(sel, dateValue)) break;
      }
      
      // Tentar diferentes seletores para data fim
      const dtFimSelectors = [
        'input[name="dadosConsulta.dtFim"]',
        'input#dtFim',
        'input[id*="dtFim"]'
      ];
      
      for (const sel of dtFimSelectors) {
        if (setDateField(sel, dateValue)) break;
      }
    }, dateBR);

    console.log('[TJSP] ✅ Datas configuradas');

    // PASSO 3: Selecionar "Todos os Cadernos"
    console.log('[TJSP] 📚 Selecionando todos os cadernos...');
    try {
      await page.selectOption('select[name="dadosConsulta.cdCaderno"]', '-11');
      console.log('[TJSP] ✅ Caderno: Todos (-11)');
    } catch (e) {
      console.log('[TJSP] ⚠️ Não foi possível selecionar caderno');
    }

    await page.waitForTimeout(1000);

    // PASSO 4: Submeter formulário
    console.log('[TJSP] 🔍 Submetendo busca...');
    
    const submitSelectors = [
      'input[type="submit"][value="Pesquisar"]',
      'input[type="submit"]',
      'button[type="submit"]',
      'input.btn',
      'button.btn'
    ];
    
    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          submitted = true;
          console.log(`[TJSP] ✅ Clicou em: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!submitted) {
      console.log('[TJSP] ⚠️ Submetendo via JavaScript...');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
    }

    // Aguardar resultados
    console.log('[TJSP] ⏳ Aguardando resultados...');
    await page.waitForTimeout(5000);

    // Screenshot para debug
    // await page.screenshot({ path: '/tmp/tjsp-2-results.png' });

    // PASSO 5: Extrair publicações
    console.log('[TJSP] 📄 Extraindo publicações...');
    
    const pageContent = await page.content();
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    
    console.log(`[TJSP] 📊 Tamanho do HTML: ${pageContent.length} chars`);
    console.log(`[TJSP] 📊 Tamanho do texto: ${bodyText.length} chars`);

    // Verificar se há mensagem de "nenhum resultado"
    const noResultsPatterns = [
      'nenhum resultado',
      'não foram encontrad',
      'não há publicações',
      'nenhuma publicação',
      '0 registro'
    ];
    
    const hasNoResults = noResultsPatterns.some(pattern => 
      bodyText.toLowerCase().includes(pattern)
    );
    
    if (hasNoResults) {
      console.log('[TJSP] ℹ️ Site retornou: Nenhum resultado encontrado');
      return [];
    }

    // Extrair publicações usando múltiplos seletores
    const results = await page.evaluate(() => {
      const publications = [];
      
      // Lista expandida de seletores para capturar publicações
      const selectors = [
        // Seletores específicos do TJSP
        '.fundocinza1',
        '.fundocinza2',
        '.conteudoPublicacao',
        '.conteudo-publicacao',
        '.texto-publicacao',
        '.itemTexto',
        '.resultadoConsulta',
        '.resultado-consulta',
        
        // Seletores de tabela
        'tr.fundocinza1 td',
        'tr.fundocinza2 td',
        'table.resultadoConsulta tr td',
        
        // Seletores genéricos
        'div[class*="publicacao"]',
        'div[class*="resultado"]',
        'td[class*="conteudo"]'
      ];
      
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          console.log(`Seletor "${selector}": ${elements.length} elementos`);
          
          elements.forEach((el, idx) => {
            const text = (el.innerText || el.textContent || '').trim();
            
            // Só aceitar textos com tamanho significativo
            if (text.length > 100) {
              // Extrair número do processo
              const processMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1,2}\.\d{2}\.\d{4})/);
              
              publications.push({
                text: text.substring(0, 8000),
                processNumber: processMatch ? processMatch[1] : null,
                selector: selector,
                index: idx
              });
            }
          });
          
          // Se encontrou publicações, não precisa tentar outros seletores
          if (publications.length > 0) {
            console.log(`Usando seletor: ${selector} (${publications.length} publicações)`);
            break;
          }
        } catch (e) {
          console.log(`Erro no seletor ${selector}: ${e.message}`);
        }
      }
      
      return publications;
    });

    console.log(`[TJSP] 📊 Publicações brutas extraídas: ${results.length}`);

    // Processar e validar cada publicação
    for (const result of results) {
      // Verificar se é relevante para o advogado
      if (!isRelevantForLawyer(result.text, job.oab_number, job.lawyer_name)) {
        continue;
      }

      // Gerar hash para deduplicação
      const textHash = simpleHash(result.text.substring(0, 500));
      if (seenHashes.has(textHash)) {
        console.log('[TJSP] ⚠️ Publicação duplicada (mesmo hash), pulando...');
        continue;
      }
      seenHashes.add(textHash);

      // Classificar tipo
      const textLower = result.text.toLowerCase();
      let type = 'other';
      if (textLower.includes('intimação') || textLower.includes('intimacao')) type = 'intimacao';
      else if (textLower.includes('sentença') || textLower.includes('sentenca')) type = 'sentenca';
      else if (textLower.includes('despacho')) type = 'despacho';
      else if (textLower.includes('decisão') || textLower.includes('decisao')) type = 'decisao';
      else if (textLower.includes('citação') || textLower.includes('citacao')) type = 'citacao';

      // Classificar urgência
      let urgency = 'normal';
      if (/urgente|urgência|citação/i.test(result.text)) urgency = 'critical';
      else if (/intimação pessoal|sentença|prazo.*\d+.*dias?/i.test(result.text)) urgency = 'high';

      allPublications.push({
        date: targetDate,
        type,
        text: result.text,
        processNumber: result.processNumber,
        urgency,
        source: 'TJSP_RAILWAY_V6',
        caderno: 'DJe',
        page: null,
        lawyers: [job.lawyer_name || `OAB ${job.oab_number}/${job.oab_state}`]
      });

      console.log(`[TJSP] ✅ Publicação válida: tipo=${type}, processo=${result.processNumber || 'N/A'}`);
    }

    console.log(`[TJSP] 📊 Total de publicações VÁLIDAS: ${allPublications.length}`);

  } catch (error) {
    console.error('[TJSP] ❌ Erro durante scraping:', error.message);
    console.error('[TJSP] Stack:', error.stack);
    throw error;
  } finally {
    await browser.close();
    console.log('[TJSP] 🔒 Browser fechado');
  }

  return allPublications;
}

async function sendToWebhook(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando ${publications.length} publicações para webhook...`);
  
  const payload = {
    jobId: job.id,
    job_id: job.id,
    oab_number: job.oab_number,
    lawyer_name: job.lawyer_name,
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
    console.log(`[WORKER] ✅ Webhook response:`, JSON.stringify(result));
    
  } catch (error) {
    console.error(`[WORKER] ❌ Erro ao enviar webhook:`, error.message);
  }
}

async function main() {
  console.log('');
  console.log('*'.repeat(60));
  console.log('[WORKER] 🚀 DJe Scraper Worker v6.0 - INICIANDO');
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL ? WEBHOOK_URL.substring(0, 50) + '...' : 'NÃO CONFIGURADA!'}`);
  console.log(`[WORKER] 🔐 Webhook Secret: ${WEBHOOK_SECRET ? '***configurado***' : 'NÃO CONFIGURADA!'}`);
  console.log(`[WORKER] 🕐 Horário: ${new Date().toISOString()}`);
  console.log('*'.repeat(60));
  
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error('[WORKER] ❌ ERRO FATAL: Variáveis de ambiente não configuradas!');
    console.error('[WORKER] Configure WEBHOOK_URL e WEBHOOK_SECRET no Railway');
    process.exit(1);
  }
  
  // Executar imediatamente
  await processJobs();
  
  // Configurar execução periódica
  console.log('[WORKER] ♾️ Configurando execução a cada 5 minutos...');
  setInterval(async () => {
    await processJobs();
  }, 5 * 60 * 1000);
}

// Capturar erros não tratados
process.on('uncaughtException', (error) => {
  console.error('[WORKER] 💥 Uncaught Exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WORKER] 💥 Unhandled Rejection at:', promise);
  console.error('[WORKER] Reason:', reason);
});

main();
