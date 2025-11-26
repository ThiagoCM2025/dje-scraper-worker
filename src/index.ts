import { processQueue } from './queue/processor.js';

console.log('🚀 DJe Scraper Worker iniciado');
console.log('📅 Verificando fila a cada 5 minutos...');

// Executar imediatamente ao iniciar
processQueue();

// Agendar execução a cada 5 minutos
setInterval(() => {
  processQueue();
}, 5 * 60 * 1000);

// Manter processo rodando
process.on('SIGINT', () => {
  console.log('👋 Worker encerrado');
  process.exit(0);
});
