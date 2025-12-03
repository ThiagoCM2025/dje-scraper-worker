// src/index.js - Railway Worker v11.2 - DJEN Scraper (ES Module)
import { chromium } from 'playwright';
import crypto from 'crypto';

// ==================== CONFIGURAÇÃO ====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || null;

// Validação de variáveis obrigatórias
if (!SUPABASE_URL) {
  console.error('[WORKER] ❌ SUPABASE_URL não configurada');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('[WORKER] ❌ WEBHOOK_SECRET não configurada');
  process.exit(1);
}

console.log('[WORKER] ✅ Variáveis de ambiente validadas');
console.log('[WORKER] 📍 SUPABASE_URL:', SUPABASE_URL);
console.log('[WORKER] 🔐 WEBHOOK_SECRET: configurado');
console.log('[WORKER] 🔑 DATAJUD_API_KEY:', DATAJUD_API_KEY ? 'configurada' : 'não configurada (fallback desabilitado)');

// ==================== FUNÇÕES UTILITÁRIAS ====================
function formatDateBR(dateString) {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

function gerarHashPublicacao(texto) {
  return crypto.createHash('md5').update(texto || '').digest('hex').substring(0, 16);
}

function validarConteudoJuridico(texto) {
  if (!texto || texto.length < 50) return false;
  const termosJuridicos = ['processo', 'vara', 'juiz', 'intimação', 'citação', 'dje', 'comarca', 
                           'advogado', 'oab', 'sentença', 'despacho', 'decisão', 'autor', 'réu'];
  const textoLower = texto.toLowerCase();
  return termosJuridicos.some(termo => textoLower.includes(termo));
}

function classificarTipo(texto) {
  const t = (texto || '').toLowerCase();
  if (t.includes('intimação') || t.includes('intimacao')) return 'intimacao';
  if (t.includes('citação') || t.includes('citacao')) return 'citacao';
  if (t.includes('sentença') || t.includes('sentenca')) return 'sentenca';
  if (t.includes('decisão') || t.includes('decisao')) return 'decisao';
  if (t.includes('despacho')) return 'despacho';
  return 'outros';
}

function classificarUrgencia(texto) {
  const t = (texto || '').toLowerCase();
  if (/urgente|urgência|citação|imediato/.test(t)) return 'critical';
  if (/intimação pessoal|sentença|prazo.*\d+.*dia/.test(t)) return 'high';
  if (/despacho|certidão/.test(t)) return 'low';
  return 'normal';
}

function extrairNumeroProcesso(texto) {
  const cnj = texto?.match(/(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/);
  if (cnj) return cnj[1];
  const antigo = texto?.match(/(\d{3,}\.?\d*\/?\d{2,4})/);
  return antigo ? antigo[1] : null;
}

// ==================== BUSCAR JOBS PENDENTES ====================
async function fetchPendingJobs() {
  console.log('[WORKER] 🔍 Buscando jobs pendentes via Edge Function...');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/dje-get-pending-jobs`, {
      method: 'GET',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[WORKER] ❌ Erro ao buscar jobs: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error('[WORKER] Response:', text);
      return [];
    }

    const data = await response.json();
    console.log(`[WORKER] ✅ ${data.count || 0} job(s) encontrado(s)`);
    return data.jobs || [];
    
  } catch (error) {
    console.error('[WORKER] ❌ Erro fatal ao buscar jobs:', error.message);
    return [];
  }
}

// ==================== SCRAPING DJEN (comunica.pje.jus.br) ====================
async function scrapeDJEN(job) {
  console.log('[DJEN] 🚀 Iniciando scraping do DJEN (comunica.pje.jus.br)...');
  console.log('[DJEN] ⚠️ NOTA: dje.tjsp.jus.br foi descontinuado em 22/07/2025');
  console.log('[DJEN] 📋 Publicações TJSP agora estão no DJEN a partir de 16/05/2025');
  
  const searchTerm = job.lawyer_name || `OAB ${job.oab_number}`;
  const targetDate = job.target_date;
  const dateBR = formatDateBR(targetDate);
  
  console.log(`[DJEN] 🔎 Buscando: ${searchTerm}`);
  console.log(`[DJEN] 📅 Data: ${dateBR}`);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const publications = [];

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page.setDefaultTimeout(60000);

    // Tentar DJEN principal
    console.log('[DJEN] 🌐 Acessando comunica.pje.jus.br...');
    
    try {
      await page.goto('https://comunica.pje.jus.br/', {
        waitUntil: 'networkidle',
        timeout: 45000
      });
      
      await page.waitForTimeout(3000);
      
      // Verificar se há formulário de busca
      const formExists = await page.evaluate(() => {
        return !!(document.querySelector('input[type="text"]') || 
                  document.querySelector('input[name*="pesquisa"]') ||
                  document.querySelector('input[name*="oab"]'));
      });
      
      if (formExists) {
        console.log('[DJEN] ✅ Formulário encontrado, tentando preencher...');
        
        // Tentar preencher campos de busca
        const inputSelectors = [
          'input[name*="oab"]',
          'input[name*="advogado"]',
          'input[name*="pesquisa"]',
          'input[type="text"]'
        ];
        
        for (const selector of inputSelectors) {
          try {
            const input = await page.$(selector);
            if (input) {
              await input.fill(searchTerm);
              console.log(`[DJEN] ✅ Campo preenchido: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        // Tentar submeter
        try {
          const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Pesquisar")');
          if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(5000);
          }
        } catch (e) {
          console.log('[DJEN] ⚠️ Botão submit não encontrado');
        }
        
        // Extrair resultados
        const results = await page.evaluate(() => {
          const items = [];
          const selectors = [
            '.publicacao', '.resultado', '.item', 
            'tr', 'div.card', 'article'
          ];
          
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              const text = (el.innerText || '').trim();
              if (text.length > 100) {
                items.push({ text: text.substring(0, 5000) });
              }
            });
            if (items.length > 0) break;
          }
          
          return items;
        });
        
        console.log(`[DJEN] 📊 ${results.length} resultados brutos encontrados`);
        
        for (const result of results) {
          if (validarConteudoJuridico(result.text)) {
            publications.push({
              date: targetDate,
              type: classificarTipo(result.text),
              text: result.text,
              processNumber: extrairNumeroProcesso(result.text),
              urgency: classificarUrgencia(result.text),
              source: 'DJEN_V11',
              tribunal: 'TJSP',
              caderno: 'Judicial',
              lawyers: [job.lawyer_name || `OAB ${job.oab_number}/${job.oab_state}`],
              hash: gerarHashPublicacao(result.text)
            });
          }
        }
      } else {
        console.log('[DJEN] ⚠️ Formulário não encontrado em comunica.pje.jus.br');
      }
      
    } catch (djenError) {
      console.log('[DJEN] ⚠️ Erro ao acessar DJEN:', djenError.message);
    }
    
    // Fallback: diario.cnj.jus.br
    if (publications.length === 0) {
      console.log('[DJEN] 🔄 Tentando fallback: diario.cnj.jus.br...');
      
      try {
        await page.goto('https://diario.cnj.jus.br/', {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        
        await page.waitForTimeout(2000);
        
        // Verificar estrutura
        const pageContent = await page.content();
        console.log('[DJEN] 📄 Página carregada, analisando estrutura...');
        
        // Similar extraction logic
        const diarioResults = await page.evaluate(() => {
          const items = [];
          document.querySelectorAll('div, article, tr').forEach(el => {
            const text = (el.innerText || '').trim();
            if (text.length > 100 && text.length < 10000) {
              items.push({ text: text.substring(0, 5000) });
            }
          });
          return items.slice(0, 50);
        });
        
        for (const result of diarioResults) {
          if (validarConteudoJuridico(result.text)) {
            const textLower = result.text.toLowerCase();
            const searchTermLower = searchTerm.toLowerCase();
            
            if (textLower.includes(searchTermLower) || 
                textLower.includes(job.oab_number) ||
                (job.lawyer_name && textLower.includes(job.lawyer_name.toLowerCase()))) {
              publications.push({
                date: targetDate,
                type: classificarTipo(result.text),
                text: result.text,
                processNumber: extrairNumeroProcesso(result.text),
                urgency: classificarUrgencia(result.text),
                source: 'DJEN_CNJ_V11',
                tribunal: 'TJSP',
                caderno: 'Judicial',
                lawyers: [job.lawyer_name || `OAB ${job.oab_number}/${job.oab_state}`],
                hash: gerarHashPublicacao(result.text)
              });
            }
          }
        }
        
      } catch (cnjError) {
        console.log('[DJEN] ⚠️ Erro no fallback CNJ:', cnjError.message);
      }
    }
    
  } catch (error) {
    console.error('[DJEN] ❌ Erro no scraping:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('[DJEN] 🔒 Browser fechado');
  }

  console.log(`[DJEN] ✅ ${publications.length} publicações encontradas`);
  return publications;
}

// ==================== FALLBACK: API DATAJUD ====================
async function searchDataJud(job) {
  if (!DATAJUD_API_KEY) {
    console.log('[DATAJUD] ⚠️ API Key não configurada, pulando fallback');
    return [];
  }
  
  console.log('[DATAJUD] 🔄 Tentando fallback via API DataJud...');
  
  const tribunalEndpoints = {
    'SP': 'https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search'
  };
  
  const endpoint = tribunalEndpoints[job.oab_state] || tribunalEndpoints['SP'];
  const searchTerm = job.lawyer_name || job.oab_number;
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${DATAJUD_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          bool: {
            should: [
              { match: { 'movimentos.complementosTabelados.descricao': searchTerm } },
              { match: { 'dadosBasicos.polo.parte.advogados.nome': searchTerm } }
            ]
          }
        },
        size: 20,
        _source: ['numeroProcesso', 'movimentos', 'dadosBasicos']
      })
    });
    
    if (!response.ok) {
      console.log(`[DATAJUD] ⚠️ API retornou ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const hits = data?.hits?.hits || [];
    
    console.log(`[DATAJUD] 📊 ${hits.length} processos encontrados`);
    
    const publications = [];
    
    for (const hit of hits) {
      const source = hit._source || {};
      const movimentos = source.movimentos || [];
      
      for (const mov of movimentos) {
        const descricao = mov?.complementosTabelados?.[0]?.descricao || mov?.nome || '';
        
        if (descricao.toLowerCase().includes('intimação') || 
            descricao.toLowerCase().includes('citação') ||
            descricao.toLowerCase().includes('sentença')) {
          
          publications.push({
            date: job.target_date,
            type: classificarTipo(descricao),
            text: descricao,
            processNumber: source.numeroProcesso,
            urgency: classificarUrgencia(descricao),
            source: 'DATAJUD_API_V11',
            tribunal: 'TJSP',
            caderno: 'Judicial',
            lawyers: [job.lawyer_name || `OAB ${job.oab_number}/${job.oab_state}`],
            hash: gerarHashPublicacao(descricao + source.numeroProcesso)
          });
        }
      }
    }
    
    console.log(`[DATAJUD] ✅ ${publications.length} publicações extraídas`);
    return publications;
    
  } catch (error) {
    console.error('[DATAJUD] ❌ Erro na API:', error.message);
    return [];
  }
}

// ==================== ENVIAR RESULTADOS ====================
async function sendResults(job, publications, errorMessage = null) {
  console.log(`[WORKER] 📤 Enviando resultados para webhook...`);
  
  const payload = {
    jobId: job.id,
    job_id: job.id,
    oab_number: job.oab_number,
    oab_state: job.oab_state,
    target_date: job.target_date,
    status: errorMessage ? 'failed' : 'completed',
    publications: publications,
    resultsCount: publications.length,
    source: 'DJEN_V11',
    worker_version: 'v11.2-DJEN-ESM',
    error: errorMessage,
    processedAt: new Date().toISOString()
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/dje-webhook-receiver`, {
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

// ==================== PROCESSAR JOBS ====================
async function processJobs() {
  console.log('[WORKER] ⏰ Iniciando processamento da fila...');
  
  const jobs = await fetchPendingJobs();
  
  if (jobs.length === 0) {
    console.log('[WORKER] ℹ️ Nenhum job pendente');
    return;
  }
  
  for (const job of jobs) {
    console.log(`\n[WORKER] ========================================`);
    console.log(`[WORKER] 🔄 Processando job: ${job.id}`);
    console.log(`[WORKER] 📋 OAB: ${job.oab_number}/${job.oab_state}`);
    console.log(`[WORKER] 👤 Advogado: ${job.lawyer_name || 'N/A'}`);
    console.log(`[WORKER] 📅 Data: ${job.target_date}`);
    
    try {
      // Tentar DJEN primeiro
      let publications = await scrapeDJEN(job);
      
      // Se não encontrou nada, tentar DataJud
      if (publications.length === 0 && DATAJUD_API_KEY) {
        console.log('[WORKER] 🔄 DJEN não retornou resultados, tentando DataJud...');
        publications = await searchDataJud(job);
      }
      
      await sendResults(job, publications);
      
      console.log(`[WORKER] ✅ Job ${job.id} concluído com ${publications.length} publicações`);
      
    } catch (error) {
      console.error(`[WORKER] ❌ Erro no job ${job.id}:`, error.message);
      await sendResults(job, [], error.message);
    }
    
    // Delay entre jobs para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`[WORKER] ✅ Todos os jobs processados`);
}

// ==================== MAIN ====================
async function main() {
  console.log('='.repeat(60));
  console.log('[WORKER] 🚀 DJe Scraper Worker v11.2 - DJEN (ES Module)');
  console.log('[WORKER] 📅 Data atual:', new Date().toISOString());
  console.log('[WORKER] ⚠️  Sistema antigo dje.tjsp.jus.br foi DESCONTINUADO em 22/07/2025');
  console.log('[WORKER] ✅ Usando DJEN (comunica.pje.jus.br) para publicações TJSP');
  console.log('='.repeat(60));
  
  // Processar imediatamente
  await processJobs();
  
  // Cron: a cada 5 minutos
  console.log('[WORKER] ♾️ Aguardando próxima execução em 5 minutos...');
  setInterval(async () => {
    console.log(`\n[WORKER] ⏰ Cron trigger: ${new Date().toISOString()}`);
    await processJobs();
    console.log('[WORKER] ♾️ Próxima execução em 5 minutos...');
  }, 5 * 60 * 1000);
}

main();
