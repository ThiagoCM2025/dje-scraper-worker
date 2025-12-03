import { chromium } from 'playwright';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';

// ========================================
// CONFIGURAÇÃO
// ========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://qiirmpifjyxbwnofkveq.supabase.co/functions/v1/dje-webhook-receiver';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[ERRO] Variáveis SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('========================================');
console.log('[INIT] 🚀 Railway Worker DJEN v11.0 iniciado');
console.log('[INIT] 📅 Data:', new Date().toISOString());
console.log('[INIT] 🔗 Webhook:', WEBHOOK_URL);
console.log('[INIT] ⚠️  IMPORTANTE: O DJE TJSP (dje.tjsp.jus.br) foi DESCONTINUADO em 22/07/2025');
console.log('[INIT] ✅ Agora usando DJEN (comunica.pje.jus.br) - Sistema Nacional do CNJ');
console.log('========================================');

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

function formatarDataBR(date) {
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const ano = date.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

function formatarDataISO(date) {
  return date.toISOString().split('T')[0];
}

function extrairNumeroProcesso(texto) {
  const match = texto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
  return match ? match[0] : null;
}

function identificarTipo(texto) {
  const textoLower = texto.toLowerCase();
  if (textoLower.includes('intimação') || textoLower.includes('intimacao') || textoLower.includes('intimado')) return 'intimacao';
  if (textoLower.includes('citação') || textoLower.includes('citacao') || textoLower.includes('citado')) return 'citacao';
  if (textoLower.includes('decisão') || textoLower.includes('decisao')) return 'decisao';
  if (textoLower.includes('sentença') || textoLower.includes('sentenca')) return 'sentenca';
  if (textoLower.includes('despacho')) return 'despacho';
  if (textoLower.includes('juntada')) return 'juntada';
  return 'outros';
}

function classificarUrgencia(texto) {
  const textoLower = texto.toLowerCase();
  
  const criticalKeywords = ['urgente', 'urgência', 'imediato', 'citação', 'prazo fatal'];
  const highKeywords = ['intimação pessoal', 'sentença', 'decisão'];
  
  if (criticalKeywords.some(k => textoLower.includes(k))) return 'critical';
  if (highKeywords.some(k => textoLower.includes(k))) return 'high';
  
  const prazoMatch = texto.match(/prazo\s+de\s+(\d+)\s+dias?/i);
  if (prazoMatch) {
    const days = parseInt(prazoMatch[1]);
    if (days <= 3) return 'critical';
    if (days <= 7) return 'high';
    if (days <= 15) return 'normal';
  }
  
  return 'normal';
}

function validarConteudoJuridico(texto) {
  const palavrasChave = [
    'advogado', 'advogada', 'oab', 'processo', 'autos',
    'intimação', 'intimacao', 'citação', 'citacao',
    'sentença', 'sentenca', 'decisão', 'decisao',
    'despacho', 'prazo', 'requerente', 'requerido',
    'autor', 'réu', 'apelante', 'apelado'
  ];
  
  const textoLower = texto.toLowerCase();
  return palavrasChave.some(palavra => textoLower.includes(palavra));
}

function gerarHashPublicacao(texto) {
  let hash = 0;
  for (let i = 0; i < texto.length; i++) {
    const char = texto.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ========================================
// SCRAPER DJEN (SISTEMA NACIONAL DO CNJ)
// ========================================

async function scraperDJEN(oabNumber, lawyerName, dataPublicacao) {
  console.log(`\n[DJEN] 🚀 INICIANDO SCRAPING NO SISTEMA NACIONAL`);
  console.log(`[DJEN] 📋 OAB: ${oabNumber}`);
  console.log(`[DJEN] 👤 Advogado: ${lawyerName || 'N/A'}`);
  console.log(`[DJEN] 📅 Data: ${dataPublicacao}`);
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const publicacoesEncontradas = [];
  const hashesVistos = new Set();

  try {
    // ========================================
    // ESTRATÉGIA 1: DJEN - comunica.pje.jus.br
    // ========================================
    console.log(`\n[DJEN] 📡 Tentando DJEN (comunica.pje.jus.br)...`);
    
    try {
      await page.goto('https://comunica.pje.jus.br/', {
        waitUntil: 'networkidle',
        timeout: 45000
      });

      console.log('[DJEN] ✅ Página DJEN carregada');
      console.log('[DJEN] 🔍 URL atual:', page.url());

      // Aguardar carregamento completo
      await page.waitForTimeout(3000);

      // Verificar se há formulário de busca
      const temFormulario = await page.$('input[type="text"], input[type="search"], #search, .search-input');
      
      if (temFormulario) {
        console.log('[DJEN] 📝 Formulário de busca encontrado');
        
        // Tentar preencher campo de busca com OAB
        const campoBusca = await page.$('input[type="text"], input[type="search"], #search, .search-input, input[name*="pesquisa"], input[name*="search"]');
        
        if (campoBusca) {
          // Buscar por número OAB
          await campoBusca.fill(oabNumber);
          console.log(`[DJEN] ✅ Campo preenchido com OAB: ${oabNumber}`);
          
          // Tentar preencher campos de data se existirem
          const campoDataInicio = await page.$('input[type="date"], input[name*="dataInicio"], input[name*="dtInicio"], #dataInicio');
          const campoDataFim = await page.$('input[type="date"], input[name*="dataFim"], input[name*="dtFim"], #dataFim');
          
          if (campoDataInicio && campoDataFim) {
            await campoDataInicio.fill(formatarDataISO(new Date()));
            await campoDataFim.fill(formatarDataISO(new Date()));
            console.log('[DJEN] ✅ Campos de data preenchidos');
          }
          
          // Selecionar tribunal TJSP se houver opção
          const seletorTribunal = await page.$('select[name*="tribunal"], select[name*="orgao"], #tribunal');
          if (seletorTribunal) {
            const opcoes = await seletorTribunal.$$eval('option', opts => 
              opts.map(o => ({ value: o.value, text: o.textContent }))
            );
            
            const opcaoTJSP = opcoes.find(o => 
              o.text.includes('TJSP') || 
              o.text.includes('São Paulo') || 
              o.value.includes('TJSP') ||
              o.value.includes('8.26')
            );
            
            if (opcaoTJSP) {
              await seletorTribunal.selectOption(opcaoTJSP.value);
              console.log('[DJEN] ✅ TJSP selecionado');
            }
          }
          
          await page.waitForTimeout(1000);
          
          // Clicar no botão de buscar
          const botaoBuscar = await page.$('button[type="submit"], input[type="submit"], button:has-text("Pesquisar"), button:has-text("Buscar"), .btn-search, #btnPesquisar');
          
          if (botaoBuscar) {
            await botaoBuscar.click();
            console.log('[DJEN] 🔍 Busca executada');
            
            // Aguardar resultados
            await page.waitForTimeout(5000);
            
            // Extrair publicações
            const resultados = await page.evaluate(() => {
              const items = [];
              
              // Tentar múltiplos seletores
              const seletores = [
                '.resultado-item',
                '.publicacao',
                '.item-publicacao',
                '[class*="resultado"]',
                '[class*="publicacao"]',
                'table tbody tr',
                '.card',
                '.list-item'
              ];
              
              for (const seletor of seletores) {
                const elementos = document.querySelectorAll(seletor);
                if (elementos.length > 0) {
                  elementos.forEach(el => {
                    const texto = el.innerText || el.textContent || '';
                    if (texto.length > 50) {
                      items.push({
                        texto: texto.substring(0, 3000),
                        html: el.innerHTML
                      });
                    }
                  });
                  break;
                }
              }
              
              return items;
            });
            
            console.log(`[DJEN] 📊 ${resultados.length} resultados brutos encontrados`);
            
            for (const resultado of resultados) {
              const hash = gerarHashPublicacao(resultado.texto);
              if (hashesVistos.has(hash)) continue;
              if (!validarConteudoJuridico(resultado.texto)) continue;
              
              // Validar se contém OAB ou nome do advogado
              const textoLower = resultado.texto.toLowerCase();
              const contemOAB = textoLower.includes(oabNumber.toLowerCase()) || 
                               textoLower.includes(`oab/${oabNumber}`) ||
                               textoLower.includes(`oab ${oabNumber}`);
              const contemNome = lawyerName && textoLower.includes(lawyerName.toLowerCase());
              
              if (!contemOAB && !contemNome) continue;
              
              hashesVistos.add(hash);
              
              publicacoesEncontradas.push({
                texto: resultado.texto,
                numeroProcesso: extrairNumeroProcesso(resultado.texto),
                tipo: identificarTipo(resultado.texto),
                urgencia: classificarUrgencia(resultado.texto),
                dataPublicacao: dataPublicacao,
                fonte: 'DJEN',
                tribunal: 'TJSP',
                hash: hash
              });
            }
          }
        }
      } else {
        console.log('[DJEN] ⚠️ Formulário de busca não encontrado na página principal');
        
        // Tentar capturar estrutura da página para debug
        const estrutura = await page.evaluate(() => {
          return {
            title: document.title,
            forms: document.querySelectorAll('form').length,
            inputs: document.querySelectorAll('input').length,
            buttons: document.querySelectorAll('button').length
          };
        });
        
        console.log('[DJEN] 📋 Estrutura da página:', JSON.stringify(estrutura));
      }
      
    } catch (djenError) {
      console.log(`[DJEN] ⚠️ Erro ao acessar DJEN: ${djenError.message}`);
    }

    // ========================================
    // ESTRATÉGIA 2: DataJUD API (Fallback)
    // ========================================
    if (publicacoesEncontradas.length === 0) {
      console.log(`\n[DATAJUD] 📡 Tentando DataJUD API como fallback...`);
      
      try {
        const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY;
        
        if (DATAJUD_API_KEY) {
          // Buscar no DataJUD por movimentações de intimação
          const dataISO = formatarDataISO(new Date());
          const dataInicio = new Date();
          dataInicio.setDate(dataInicio.getDate() - 7); // Últimos 7 dias
          
          const response = await fetch('https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search', {
            method: 'POST',
            headers: {
              'Authorization': `APIKey ${DATAJUD_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              size: 100,
              query: {
                bool: {
                  must: [
                    {
                      nested: {
                        path: "movimentos",
                        query: {
                          bool: {
                            should: [
                              { match: { "movimentos.nome": "intimação" } },
                              { match: { "movimentos.nome": "intimado" } },
                              { match: { "movimentos.nome": "ciência" } }
                            ],
                            minimum_should_match: 1
                          }
                        }
                      }
                    },
                    {
                      range: {
                        "dataAjuizamento": {
                          gte: dataInicio.toISOString().split('T')[0],
                          lte: dataISO
                        }
                      }
                    }
                  ],
                  should: [
                    { match_phrase: { "silesAdvogados.nome": lawyerName || oabNumber } }
                  ]
                }
              },
              _source: ["numeroProcesso", "classe", "assuntos", "movimentos", "dataAjuizamento"]
            })
          });

          if (response.ok) {
            const data = await response.json();
            const hits = data.hits?.hits || [];
            
            console.log(`[DATAJUD] 📊 ${hits.length} processos encontrados`);
            
            for (const hit of hits) {
              const processo = hit._source;
              const movimentos = processo.movimentos || [];
              
              // Filtrar apenas movimentos de intimação recentes
              const intimacoes = movimentos.filter(m => {
                const nomeMovimento = (m.nome || '').toLowerCase();
                return nomeMovimento.includes('intimação') || 
                       nomeMovimento.includes('intimado') ||
                       nomeMovimento.includes('ciência');
              });
              
              for (const intimacao of intimacoes) {
                const textoCompleto = `
                  Processo: ${processo.numeroProcesso}
                  Classe: ${processo.classe?.nome || 'N/A'}
                  Movimento: ${intimacao.nome}
                  Complemento: ${intimacao.complemento || ''}
                `.trim();
                
                const hash = gerarHashPublicacao(textoCompleto);
                if (hashesVistos.has(hash)) continue;
                
                hashesVistos.add(hash);
                
                publicacoesEncontradas.push({
                  texto: textoCompleto,
                  numeroProcesso: processo.numeroProcesso,
                  tipo: identificarTipo(intimacao.nome),
                  urgencia: classificarUrgencia(textoCompleto),
                  dataPublicacao: intimacao.dataHora || dataPublicacao,
                  fonte: 'DATAJUD',
                  tribunal: 'TJSP',
                  hash: hash
                });
              }
            }
          } else {
            console.log(`[DATAJUD] ⚠️ API retornou status ${response.status}`);
          }
        } else {
          console.log('[DATAJUD] ⚠️ DATAJUD_API_KEY não configurada');
        }
        
      } catch (datajudError) {
        console.log(`[DATAJUD] ⚠️ Erro na API DataJUD: ${datajudError.message}`);
      }
    }

    // ========================================
    // ESTRATÉGIA 3: diario.cnj.jus.br (Fallback 2)
    // ========================================
    if (publicacoesEncontradas.length === 0) {
      console.log(`\n[DIARIO-CNJ] 📡 Tentando diario.cnj.jus.br como fallback final...`);
      
      try {
        await page.goto('https://diario.cnj.jus.br/', {
          waitUntil: 'networkidle',
          timeout: 45000
        });

        console.log('[DIARIO-CNJ] ✅ Página carregada');
        await page.waitForTimeout(3000);

        // Extrair informações da estrutura da página
        const estrutura = await page.evaluate(() => {
          return {
            title: document.title,
            url: window.location.href,
            forms: Array.from(document.querySelectorAll('form')).map(f => ({
              id: f.id,
              action: f.action,
              method: f.method
            })),
            inputs: Array.from(document.querySelectorAll('input')).map(i => ({
              name: i.name,
              id: i.id,
              type: i.type
            }))
          };
        });
        
        console.log('[DIARIO-CNJ] 📋 Estrutura:', JSON.stringify(estrutura, null, 2));
        
      } catch (diarioError) {
        console.log(`[DIARIO-CNJ] ⚠️ Erro: ${diarioError.message}`);
      }
    }

  } catch (error) {
    console.error(`[SCRAPER] ❌ Erro geral no scraping:`, error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('[SCRAPER] 🔒 Browser fechado');
  }

  console.log(`\n[SCRAPER] 🎯 RESULTADO FINAL: ${publicacoesEncontradas.length} publicações únicas`);
  return publicacoesEncontradas;
}

// ========================================
// ENVIAR RESULTADOS PARA WEBHOOK
// ========================================

async function enviarParaWebhook(jobId, oabNumber, lawyerName, publicacoes, dataPublicacao, monitoringId) {
  console.log(`\n[WEBHOOK] 📤 Enviando ${publicacoes.length} publicações para webhook`);
  console.log(`[WEBHOOK] 🌐 URL: ${WEBHOOK_URL}`);
  
  try {
    const payload = {
      job_id: jobId,
      monitoring_id: monitoringId,
      oab_number: oabNumber,
      lawyer_name: lawyerName,
      search_date: dataPublicacao,
      tribunal: 'TJSP',
      source: 'DJEN_V11',
      publications: publicacoes.map(pub => ({
        text: pub.texto,
        date: pub.dataPublicacao,
        process_number: pub.numeroProcesso,
        type: pub.tipo,
        urgency: pub.urgencia,
        source: pub.fonte,
        hash: pub.hash
      })),
      total: publicacoes.length,
      timestamp: new Date().toISOString(),
      worker_version: 'v11.0-DJEN'
    };

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log(`[WEBHOOK] 📨 Response status: ${response.status}`);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText };
    }

    if (!response.ok) {
      throw new Error(`Webhook retornou status ${response.status}: ${responseText}`);
    }

    console.log(`[WEBHOOK] ✅ Resultados enviados:`, JSON.stringify(result));
    return result;

  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erro ao enviar:`, error.message);
    throw error;
  }
}

// ========================================
// PROCESSAR JOBS PENDENTES
// ========================================

async function processarJobs() {
  console.log('\n========================================');
  console.log('[WORKER] 🔄 Buscando jobs pendentes...');
  console.log('[WORKER] 📅 Horário:', new Date().toISOString());
  
  try {
    const { data: jobs, error } = await supabase
      .from('dje_scraping_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('[WORKER] ❌ Erro ao buscar jobs:', error.message);
      return;
    }

    if (!jobs || jobs.length === 0) {
      console.log('[WORKER] ℹ️ Nenhum job pendente');
      return;
    }

    console.log(`[WORKER] ✅ ${jobs.length} jobs encontrados para processar`);

    for (const job of jobs) {
      console.log(`\n[WORKER] 🔨 Processando Job ID: ${job.id}`);
      console.log(`[WORKER]    OAB: ${job.oab_number}`);
      console.log(`[WORKER]    Advogado: ${job.lawyer_name || 'N/A'}`);
      console.log(`[WORKER]    Data: ${job.search_date || 'hoje'}`);
      console.log(`[WORKER]    Tentativa: ${(job.retry_count || 0) + 1}/3`);
      
      // Marcar como processando
      await supabase
        .from('dje_scraping_queue')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .eq('id', job.id);

      try {
        // Definir data de busca
        const hoje = new Date();
        const dataPublicacao = job.search_date || formatarDataBR(hoje);
        
        // Executar scraping
        const publicacoes = await scraperDJEN(
          job.oab_number, 
          job.lawyer_name,
          dataPublicacao
        );

        // Enviar para webhook
        await enviarParaWebhook(
          job.id,
          job.oab_number,
          job.lawyer_name,
          publicacoes,
          dataPublicacao,
          job.monitoring_id
        );

        // Marcar como completo
        await supabase
          .from('dje_scraping_queue')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString(),
            result: { 
              publications_found: publicacoes.length,
              source: 'DJEN_V11',
              worker_version: 'v11.0'
            }
          })
          .eq('id', job.id);

        console.log(`[WORKER] ✅ Job ${job.id} concluído: ${publicacoes.length} publicações`);

      } catch (error) {
        console.error(`[WORKER] ❌ Erro no Job ${job.id}:`, error.message);
        
        // Incrementar retry
        await supabase
          .from('dje_scraping_queue')
          .update({ 
            status: 'pending',
            retry_count: (job.retry_count || 0) + 1,
            error_message: error.message
          })
          .eq('id', job.id);
      }
    }

  } catch (error) {
    console.error('[WORKER] ❌ Erro geral:', error);
  }
  
  console.log('');
  console.log('[WORKER] ✅ Ciclo concluído.');
  console.log('');
  console.log('[WORKER] ♾️ Próxima execução em 5 minutos...');
}

// ========================================
// CRON JOB - A CADA 5 MINUTOS
// ========================================

console.log('[CRON] ⏰ Configurando CRON job a cada 5 minutos');

cron.schedule('*/5 * * * *', async () => {
  await processarJobs();
});

// Executar imediatamente na inicialização
console.log('[INIT] 🚀 Executando primeira verificação...');
processarJobs();

// Manter o processo vivo
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] 🛑 Recebido SIGTERM, encerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] 🛑 Recebido SIGINT, encerrando...');
  process.exit(0);
});
