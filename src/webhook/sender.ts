import { WebhookPayload, WebhookResponse } from '../types.js';

const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  console.log(`[WEBHOOK] 📤 Enviando resultado do job ${payload.jobId}...`);

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
      throw new Error(`Webhook failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as WebhookResponse;
    console.log(`[WEBHOOK] ✅ Webhook enviado: ${result.publicationsInserted} publicações inseridas`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Erro ao enviar webhook:', error);
    throw error;
  }
}
