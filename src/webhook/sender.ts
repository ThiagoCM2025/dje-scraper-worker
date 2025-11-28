// src/webhook/sender.ts
import { Publication, WebhookResponse } from './types';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function sendResult(
  jobId: string, 
  status: 'completed' | 'failed', 
  publications: Publication[] = [], 
  error: string | null = null
): Promise<void> {
  if (!SUPABASE_PROJECT_URL || !WEBHOOK_SECRET) {
    console.error('[WEBHOOK] ❌ Variáveis de ambiente não configuradas!');
    return;
  }

  const webhookUrl = `${SUPABASE_PROJECT_URL}/functions/v1/dje-webhook-receiver`;
  console.log(`[WEBHOOK] Enviando resultado para: ${webhookUrl}`);
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jobId,
        status,
        publications,
        error,
        resultsCount: publications.length
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao enviar resultado: ${response.status} - ${errorText}`);
    }
    
    // ✅ CORREÇÃO: Type assertion explícito
    const result = await response.json() as WebhookResponse;
    console.log(`[WEBHOOK] ✅ Resultado enviado com sucesso:`, result.message || 'OK');
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[WEBHOOK] ❌ Erro ao enviar:', errorMessage);
    throw error;
  }
}
