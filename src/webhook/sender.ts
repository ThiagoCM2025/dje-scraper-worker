import type { Publication, WebhookPayload } from '../types.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_URL) {
  console.warn('[WORKER] WEBHOOK_URL não definido; o worker não conseguirá notificar o backend.');
}
if (!WEBHOOK_SECRET) {
  console.warn('[WORKER] WEBHOOK_SECRET não definido; o backend recusará as notificações.');
}

export async function sendWebhookUpdate(
  jobId: string,
  status: 'completed' | 'failed',
  publications: Publication[],
  error?: string
) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_URL ou WEBHOOK_SECRET não configurados no ambiente do worker.');
  }

  const payload: WebhookPayload = {
    jobId,
    status,
    publications: status === 'completed' ? publications : undefined,
    error,
    resultsCount: publications.length
  };

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': WEBHOOK_SECRET
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Webhook retornou ${res.status}: ${body}`);
  }

  console.log('[WORKER] Webhook enviado com sucesso. Job:', jobId, 'Resultados:', publications.length);
}
