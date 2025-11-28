// IMPORTANTE: Caminho relativo correto - subir um nível com ../
import { WebhookPayload, WebhookResponse } from '../types';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  console.log(`[WEBHOOK] Sending result for job ${payload.jobId} - status: ${payload.status}`);

  try {
    const response = await fetch(`${SUPABASE_PROJECT_URL}/functions/v1/dje-webhook-receiver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WEBHOOK] Error response:', response.status, errorText);
      throw new Error(`Webhook failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as WebhookResponse;
    console.log('[WEBHOOK] Result sent successfully:', result);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WEBHOOK] Error sending webhook:', errorMessage);
    throw error;
  }
}
