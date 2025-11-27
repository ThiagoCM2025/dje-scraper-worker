import { createClient } from '@supabase/supabase-js';
import { processQueue } from './queue/processor.js';

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Intervalo de polling em ms (5 minutos)
const POLL_INTERVAL = 5 * 60 * 1000;

async function main() {
  console.log('🚀 DJE Worker iniciado');
  console.log(`📡 Conectado ao Supabase: ${supabaseUrl}`);
  console.log(`⏱️ Intervalo de polling: ${POLL_INTERVAL / 1000}s`);

  // Executar imediatamente na inicialização
  await runProcessQueue();

  // Configurar intervalo para polling contínuo
  setInterval(runProcessQueue, POLL_INTERVAL);

  console.log('✅ Worker rodando. Aguardando jobs...');
}

async function runProcessQueue() {
  try {
    console.log(`\n[${new Date().toISOString()}] 🔍 Verificando fila de jobs...`);
    await processQueue();
  } catch (error) {
    console.error('❌ Erro no processamento da fila:', error);
  }
}

// Iniciar worker
main().catch((error) => {
  console.error('💀 Erro fatal ao iniciar worker:', error);
  process.exit(1);
});
