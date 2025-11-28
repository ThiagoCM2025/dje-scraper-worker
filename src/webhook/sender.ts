// src/webhook/sender.ts
import { Publication, WebhookResponse } from '../types';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

export async function sendResult(
  jobId: string,
  status: 'completed' | 'failed',
  publications: Publication[] = [],
  errorMessage?: string
): Promise<void> {
  const webhookUrl = `${SUPABASE_PROJECT_URL}/functions/v1/dje-webhook-receiver`;
  console.log(`[WEBHOOK] Enviando resultado para: ${webhookUrl}`);
  
  const payload = {
    jobId,
    status,
    publications,
    error: errorMessage || null,
    resultsCount: publications.length
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'x-webhook-secret': WEBHOOK_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao enviar resultado: ${response.status} - ${errorText}`);
  }
  
  const result: WebhookResponse = await response.json();
  console.log(`[WEBHOOK] ✅ Resultado enviado:`, result.message || 'OK');
}
