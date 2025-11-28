import { CronJob } from 'cron';
import { processQueue } from './queue/processor';

console.log('[WORKER] DJe Scraper Worker v3.0 starting...');
console.log('[WORKER] Environment check:');
console.log('  - SUPABASE_PROJECT_URL:', process.env.SUPABASE_PROJECT_URL ? '✓ Set' : '✗ Missing');
console.log('  - WEBHOOK_SECRET:', process.env.WEBHOOK_SECRET ? '✓ Set' : '✗ Missing');

// Processar fila a cada 5 minutos
const job = new CronJob('*/5 * * * *', async () => {
  console.log('[WORKER] Cron triggered - checking for pending jobs...');
  try {
    await processQueue();
  } catch (error) {
    console.error('[WORKER] Error in cron job:', error);
  }
});

job.start();
console.log('[WORKER] Cron job started - running every 5 minutes');

// Também executar imediatamente na inicialização
console.log('[WORKER] Running initial queue check...');
processQueue().catch((error) => {
  console.error('[WORKER] Error in initial queue check:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[WORKER] SIGTERM received, stopping...');
  job.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[WORKER] SIGINT received, stopping...');
  job.stop();
  process.exit(0);
});
