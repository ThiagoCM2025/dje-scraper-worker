import { WebhookPayload } from '../types';

const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  console.log(`📤 Enviando webhook para job ${payload.job_id}...`);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook falhou: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Webhook enviado com sucesso para job ${payload.job_id}`);
  } catch (error) {
    console.error(`❌ Erro ao enviar webhook:`, error);
    throw error;
  }
}
