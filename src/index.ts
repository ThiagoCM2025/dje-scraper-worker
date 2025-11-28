import { CronJob } from 'cron';
import { processQueue } from './queue/processor.js';

// ============================================
// CONFIGURAÇÃO DO CRON - 3x POR DIA
// ============================================
// Horários BRT (America/Sao_Paulo):
// - 06:00 - Primeira verificação matinal
// - 12:00 - Verificação do meio-dia
// - 18:00 - Verificação final do dia
// ============================================
const CRON_SCHEDULE = '0 6,12,18 * * *';

const VERSION = '3.1.0';
const START_TIME = new Date().toISOString();

console.log('═══════════════════════════════════════════════════════');
console.log(`[WORKER] 🚀 DJE Scraper Worker v${VERSION} iniciando...`);
console.log(`[WORKER] 📅 Data/Hora início: ${START_TIME}`);
console.log(`[WORKER] ⏰ Agendamento: ${CRON_SCHEDULE}`);
console.log(`[WORKER] 🌎 Timezone: America/Sao_Paulo`);
console.log(`[WORKER] 📋 Execuções: 06:00, 12:00, 18:00 (BRT)`);
console.log('═══════════════════════════════════════════════════════');

// Verificar variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!SUPABASE_URL) {
  console.error('[WORKER] ❌ ERRO CRÍTICO: SUPABASE_PROJECT_URL não configurada!');
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.error('[WORKER] ❌ ERRO CRÍTICO: WEBHOOK_SECRET não configurado!');
  process.exit(1);
}

console.log('[WORKER] ✅ Variáveis de ambiente validadas');
console.log(`[WORKER] 🔗 URL: ${SUPABASE_URL.substring(0, 30)}...`);

// Configurar cron job
const job = new CronJob(
  CRON_SCHEDULE,
  async () => {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`[WORKER] ⏰ Cron job triggered: ${now}`);
    console.log('═══════════════════════════════════════════════════════');
    
    try {
      await processQueue();
      console.log('[WORKER] ✅ Ciclo de processamento concluído');
    } catch (error) {
      console.error('[WORKER] ❌ Erro no ciclo de processamento:', error);
    }
    
    // Calcular próxima execução
    const nextRun = job.nextDate();
    console.log(`[WORKER] 📅 Próxima execução: ${nextRun.toFormat('dd/MM/yyyy HH:mm')} BRT`);
    console.log('');
  },
  null,
  true, // Start immediately
  'America/Sao_Paulo' // Timezone BRT
);

console.log('[WORKER] ✅ Cron job configurado com sucesso');

// Mostrar próxima execução programada
const nextRun = job.nextDate();
console.log(`[WORKER] 📅 Próxima execução agendada: ${nextRun.toFormat('dd/MM/yyyy HH:mm')} BRT`);

// Executar imediatamente na inicialização para validar que tudo funciona
console.log('[WORKER] 🔄 Executando verificação inicial...');
processQueue()
  .then(() => {
    console.log('[WORKER] ✅ Verificação inicial concluída');
    console.log('[WORKER] 💤 Worker em standby. Aguardando próximo horário agendado...');
  })
  .catch((error) => {
    console.error('[WORKER] ❌ Erro na execução inicial:', error);
  });

// Handlers de shutdown gracioso
process.on('SIGINT', () => {
  console.log('');
  console.log('[WORKER] 🛑 Recebido SIGINT. Parando worker graciosamente...');
  job.stop();
  console.log('[WORKER] ✅ Cron job parado');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('');
  console.log('[WORKER] 🛑 Recebido SIGTERM. Parando worker graciosamente...');
  job.stop();
  console.log('[WORKER] ✅ Cron job parado');
  process.exit(0);
});

// Handler de exceções não tratadas
process.on('uncaughtException', (error) => {
  console.error('[WORKER] ❌ Exceção não tratada:', error);
  job.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WORKER] ❌ Promise rejeitada não tratada:', reason);
});
