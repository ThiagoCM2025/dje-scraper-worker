// src/webhook/sender.ts
import { WebhookPayload, WebhookResponse } from '../types.js';

const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  console.log(`[WEBHOOK] 📤 Enviando resultado do job ${payload.jobId}...`);
  console.log(`[WEBHOOK] 📍 URL: ${SUPABASE_URL}/functions/v1/dje-webhook-receiver`);
  console.log(`[WEBHOOK] 📊 Publicações: ${payload.publications?.length || 0}`);
  
  if (!SUPABASE_URL) {
    throw new Error('[WEBHOOK] ❌ SUPABASE_PROJECT_URL não configurada!');
  }
  
  if (!WEBHOOK_SECRET) {
    throw new Error('[WEBHOOK] ❌ WEBHOOK_SECRET não configurada!');
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/dje-webhook-receiver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WEBHOOK] ❌ Resposta não-OK: ${response.status}`);
      console.error(`[WEBHOOK] ❌ Detalhes: ${errorText}`);
      throw new Error(`Webhook failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as WebhookResponse;
    console.log(`[WEBHOOK] ✅ Webhook enviado: ${result.publicationsInserted} publicações inseridas`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Erro ao enviar webhook:', error);
    throw error;
  }
}
