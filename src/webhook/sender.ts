import { WebhookPayload } from '../types.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  if (!WEBHOOK_URL) {
    console.log('⚠️ WEBHOOK_URL não configurada, pulando envio');
    return;
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SECRET && { 'X-Webhook-Secret': WEBHOOK_SECRET }),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`❌ Webhook falhou: ${response.status} ${response.statusText}`);
    } else {
      console.log(`✅ Webhook enviado com sucesso para ${WEBHOOK_URL}`);
    }
  } catch (error) {
    console.error('❌ Erro ao enviar webhook:', error);
  }
}
