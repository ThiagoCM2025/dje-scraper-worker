import cron from 'node-cron';
import { processQueue } from './queue/processor';

console.log('🚀 DJE Railway Worker v2.0 (Edge Function Mode)');
console.log('📡 Conectando via Edge Functions...');

// Processar a cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  console.log('⏰ [CRON] Executando processamento da fila...');
  await processQueue();
});

// Executar imediatamente ao iniciar
console.log('🔄 Executando processamento inicial...');
processQueue();
