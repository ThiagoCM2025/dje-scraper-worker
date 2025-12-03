// src/index.js - Railway Worker v5.0 - Validação Estrita + Deduplicação
import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function formatDateBR(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * VALIDAÇÃO ESTRITA de relevância para o advogado
 * Só aceita publicações com:
 * 1. OAB EXATA no texto, OU
 * 2. Nome COMPLETO exato do advogado
 */
function isRelevantForLawyer(text, oabNumber, lawyerName) {
  if (!text || text.length < 50) return false;
  
  const upperText = text.toUpperCase();
  const normalizedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  
  // Extrair apenas dígitos da OAB
  const oabNumOnly = oabNumber.replace(/[^0-9]/g, '');
  
  // Método 1: OAB EXATA no texto (múltiplos formatos)
  const oabPatterns = [
    new RegExp(`OAB[:\\s/]*${oabNumOnly}`, 'i'),
    new RegExp(`OAB[:\\s/]*(SP)?[:\\s/-]*${oabNumOnly}`, 'i'),
    new RegExp(`${oabNumOnly}[/\\s-]*SP`, 'i'),
    new RegExp(`OAB[:\\s]*SP[:\\s/-]*${oabNumOnly}`, 'i'),
    new RegExp(`\\b${oabNumOnly}\\b.*OAB`, 'i'),
  ];
  
  for (const pattern of oabPatterns) {
    if (pattern.test(text)) {
      console.log(`[VALIDATION] ✅ OAB ${oabNumOnly} encontrada no texto`);
      return true;
    }
  }
  
  // Método 2: Nome COMPLETO exato (todos os termos em sequência)
  if (lawyerName && lawyerName.trim().length > 0) {
    const normalizedName = lawyerName
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().trim();
    
    if (normalizedText.includes(normalizedName)) {
      console.log(`[VALIDATION] ✅ Nome completo "${lawyerName}" encontrado no texto`);
      return true;
    }
  }
  
  // Nenhum critério atendido
  console.log(`[VALIDATION] ❌ Publicação NÃO relevante - texto: "${text.substring(0, 80)}..."`);
  return false;
}

/**
 * Gera hash simples para deduplicação
 */
function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
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
      console.log(`[WORKER] 👤 Advogado: ${job.lawyer_name || 'N/A'}`);

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
  console.log('[TJSP] 🔍 Iniciando scraping com VALIDAÇÃO ESTRITA...');
  
  const targetDate = job.target_date;
  const dateBR = formatDateBR(targetDate);
  const lawyerName = job.lawyer_name || '';
  const oabNumber = job.oab_number || '';
  
  // IMPORTANTE: Buscar pelo NOME do advogado (como Jusbrasil faz)
  const searchTerm = lawyerName || `OAB ${oabNumber}`;
  
  console.log(`[TJSP] 📋 OAB: ${oabNumber}, Nome: "${lawyerName}", Data: ${targetDate}`);
  console.log(`[TJSP] 🔎 Termo de busca: "${searchTerm}"`);
  console.log(`[TJSP] 📅 Data formatada BR: ${dateBR}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const allPublications = [];
  const seenHashes = new Set(); // Para deduplicação local

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
    
    // Campo pesquisa livre - usar NOME do advogado (como Jusbrasil)
    try {
      await page.fill('input[name="dadosConsulta.pesquisaLivre"]', searchTerm);
      console.log(`[TJSP] ✅ Campo pesquisaLivre preenchido com: "${searchTerm}"`);
    } catch (e) {
      await page.evaluate((term) => {
        const el = document.querySelector('input[name="dadosConsulta.pesquisaLivre"]');
        if (el) { el.value = term; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, searchTerm);
    }

    // Campos de data readonly via JavaScript
    console.log('[TJSP] 📅 Preenchendo datas via JavaScript...');
    
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

    // Aguardar carregamento dos resultados
    await page.waitForTimeout(5000);

    // Verificar se há resultados
    const noResults = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      return bodyText.includes('Nenhum resultado') || 
             bodyText.includes('não foram encontrad') ||
             bodyText.includes('Não há publicações');
    });

    if (noResults) {
      console.log('[TJSP] ℹ️ Nenhuma publicação encontrada no TJSP');
      return [];
    }

    // Extrair publicações com múltiplos seletores
    console.log('[TJSP] 📄 Extraindo publicações...');
    
    const results = await page.evaluate(() => {
      const pubs = [];
      
      // Lista de seletores em ordem de prioridade
      const selectorGroups = [
        // Seletores de conteúdo principal
        '.conteudo-publicacao',
        '.texto-publicacao',
        '.itemTexto',
        // Seletores de tabela
        'tr.fundocinza1 td',
        'tr.fundocinza2 td',
        '.fundocinza1',
        '.fundocinza2',
        // Seletores alternativos
        '.resultados-busca .item',
        '.lista-resultados .item',
        'div[class*="publicacao"]',
        'div[class*="resultado"]'
      ];
      
      for (const selector of selectorGroups) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.innerText || el.textContent || '').trim();
          // Só aceitar textos com tamanho significativo (conteúdo real)
          if (text.length > 200) {
            // Extrair número do processo se houver
            const processMatch = text.match(/(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/);
            pubs.push({ 
              text: text.substring(0, 8000), // Texto maior para não perder dados
              processNumber: processMatch?.[1] || null 
            });
          }
        });
        
        // Se encontrou publicações neste seletor, parar
        if (pubs.length > 0) {
          console.log(`[TJSP] Encontrou ${pubs.length} publicações com seletor: ${selector}`);
          break;
        }
      }
      
      return pubs;
    });

    console.log(`[TJSP] 📊 ${results.length} publicações brutas extraídas`);

    // VALIDAÇÃO ESTRITA: Filtrar APENAS publicações relevantes
    for (const result of results) {
      // Verificar relevância ANTES de adicionar
      if (!isRelevantForLawyer(result.text, oabNumber, lawyerName)) {
        console.log(`[TJSP] ❌ Publicação FILTRADA (não relevante para ${lawyerName || oabNumber})`);
        continue;
      }

      // Deduplicação local via hash
      const textHash = simpleHash(result.text);
      if (seenHashes.has(textHash)) {
        console.log(`[TJSP] ⚠️ Publicação duplicada ignorada`);
        continue;
      }
      seenHashes.add(textHash);

      // Classificar tipo
      const textLower = result.text.toLowerCase();
      let type = 'other';
      if (textLower.includes('intimação') || textLower.includes('intimacao')) type = 'intimacao';
      else if (textLower.includes('sentença')) type = 'sentenca';
      else if (textLower.includes('despacho')) type = 'despacho';
      else if (textLower.includes('decisão')) type = 'decisao';
      else if (textLower.includes('citação') || textLower.includes('citacao')) type = 'citacao';

      // Classificar urgência
      let urgency = 'normal';
      if (/urgente|citação|prazo.*\d+.*dia/i.test(result.text)) urgency = 'critical';
      else if (/intimação pessoal|sentença|audiência/i.test(result.text)) urgency = 'high';

      allPublications.push({
        date: targetDate,
        type,
        text: result.text,
        processNumber: result.processNumber,
        urgency,
        source: 'TJSP_RAILWAY_V5',
        lawyers: [lawyerName || `OAB ${oabNumber}/${job.oab_state}`],
        textHash // Enviar hash para deduplicação no webhook
      });

      console.log(`[TJSP] ✅ Publicação VÁLIDA adicionada (processo: ${result.processNumber || 'N/A'})`);
    }

    console.log(`[TJSP] 🎯 RESULTADO FINAL: ${allPublications.length} publicações VÁLIDAS de ${results.length} extraídas`);

  } catch (error) {
    console.error('[TJSP] ❌ Erro:', error.message);
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
    lawyer_name: job.lawyer_name, // IMPORTANTE: Enviar nome para validação no webhook
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
    
    if (result.publicationsInserted > 0) {
      console.log(`[WORKER] 🎉 ${result.publicationsInserted} publicações inseridas no AuraLex!`);
    } else if (publications.length > 0) {
      console.log(`[WORKER] ⚠️ ${publications.length} enviadas mas ${result.publicationsFiltered || 0} filtradas no webhook`);
    }
    
  } catch (error) {
    console.error(`[WORKER] ❌ Erro webhook:`, error.message);
  }
}

async function main() {
  console.log('[WORKER] 🚀 DJe Scraper Worker v5.0 iniciado');
  console.log('[WORKER] ✅ Validação estrita + Deduplicação ativada');
  console.log(`[WORKER] 📡 Webhook URL: ${WEBHOOK_URL}`);
  
  await processJobs();
  
  console.log('[WORKER] ♾️ Próxima execução em 5 minutos.');
  setInterval(async () => {
    console.log('[WORKER] ⏰ Cron trigger');
    await processJobs();
  }, 5 * 60 * 1000);
}

main();
