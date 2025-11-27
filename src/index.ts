import { createClient } from '@supabase/supabase-js';
import { processQueue } from './queue/processor';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Intervalo de execução: 5 minutos
const INTERVAL_MS = 5 * 60 * 1000;

// ✅ Inicializar Supabase SEM tipagem forte e SEM pacote "cron"
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('🚀 DJE Worker iniciado');
console.log('📡 Conectando ao Supabase...');
console.log(`⏰ Configurando loop a cada ${INTERVAL_MS / 60000} minutos (setInterval)`);

let isShuttingDown = false;

async function runCycle() {
  if (isShuttingDown) {
    console.log('⏹️ Worker em desligamento, ignorando novo ciclo.');
    return;
  }

  console.log('\n⏰ [LOOP] Executando verificação da fila...');
  try {
    await processQueue();
    console.log('✅ [LOOP] Fila processada com sucesso');
  } catch (error) {
    console.error('❌ [LOOP] Erro ao processar fila:', error);
  }
}

// Executa uma vez na subida
runCycle();

// Agenda execução recorrente a cada 5 minutos
const intervalId = setInterval(runCycle, INTERVAL_MS);

console.log('✅ Worker em execução. Aguardando jobs...');

// Tratamento de encerramento gracioso
function shutdown(signal: string) {
  console.log(`🛑 Sinal ${signal} recebido, encerrando worker...`);
  isShuttingDown = true;
  clearInterval(intervalId);
  // Pequeno delay opcional para terminar ciclos em andamento
  setTimeout(() => {
    console.log('👋 Worker finalizado com segurança.');
    process.exit(0);
  }, 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
