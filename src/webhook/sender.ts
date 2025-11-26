interface WebhookPayload {
  jobId: string;
  visitorId: string;
  visitorType: string;
  success: boolean;
  publications: any[];
  error?: string;
}

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  const webhookUrl = `${process.env.SUPABASE_URL}/functions/v1/dje-webhook-receiver`;
  
  console.log(`📤 Enviando webhook para ${webhookUrl}`);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'x-webhook-secret': process.env.WEBHOOK_SECRET || ''
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook falhou: ${response.status} - ${text}`);
  }

  console.log('✅ Webhook enviado com sucesso');
}
