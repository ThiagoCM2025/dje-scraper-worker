// src/index.ts
import { CronJob } from 'cron';
import { processQueue } from './queue/processor';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

console.log('🚀 DJE Railway Worker v2.0 (Edge Function Mode)');
console.log('📡 Configuração:');
console.log(`   - SUPABASE_PROJECT_URL: ${SUPABASE_PROJECT_URL ? '✓ Configurado' : '✗ FALTANDO!'}`);
console.log(`   - WEBHOOK_SECRET: ${WEBHOOK_SECRET ? '✓ Configurado' : '✗ FALTANDO!'}`);

if (!SUPABASE_PROJECT_URL || !WEBHOOK_SECRET) {
  console.error('❌ Variáveis de ambiente obrigatórias não configuradas!');
  process.exit(1);
}

// Processar a cada 5 minutos
const job = new CronJob('*/5 * * * *', async () => {
  console.log('\n⏰ [CRON] Executando verificação da fila...');
  try {
    await processQueue();
  } catch (error) {
    console.error('❌ [CRON] Erro ao processar fila:', error);
  }
});

job.start();
console.log('✅ Cron job iniciado (executa a cada 5 minutos)');

// Executar imediatamente ao iniciar
console.log('🔄 Executando processamento inicial...');
processQueue().catch(err => {
  console.error('❌ Erro no processamento inicial:', err);
});

// Manter processo vivo e tratar shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando worker...');
  job.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando worker...');
  job.stop();
  process.exit(0);
});
