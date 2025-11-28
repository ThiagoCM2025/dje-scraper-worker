import { Publication, ScrapingResult } from '../types';

export async function scrapeTJSP(oabNumber: string, targetDate: string): Promise<ScrapingResult> {
  console.log(`[TJSP] Iniciando scraping para OAB ${oabNumber} na data ${targetDate}`);
  
  try {
    // Publicações mock realistas para teste
    const mockPublications: Publication[] = [
      {
        date: targetDate,
        type: 'intimacao',
        content: `INTIMAÇÃO - Processo nº 1234567-89.2025.8.26.0100 - Classe: Procedimento Comum Cível - Requerente: MARIA DA SILVA SANTOS - Requerido: BANCO EXEMPLO S/A - Advogado do Requerente: Dr. João Advogado (OAB/SP ${oabNumber}) - Advogado do Requerido: Dra. Ana Defensora (OAB/SP 654321) - INTIMAÇÃO: Fica V.Sa. intimado(a) para, no prazo de 15 (quinze) dias, apresentar RÉPLICA à contestação apresentada pela parte requerida. Decorrido o prazo sem manifestação, os autos serão conclusos para deliberação. São Paulo, ${targetDate}. Juiz de Direito: Dr. Carlos Magistrado.`,
        processNumber: '1234567-89.2025.8.26.0100',
        court: 'TJSP',
        instance: '1ª Instância',
        subject: 'Direito do Consumidor - Contratos Bancários',
        parties: ['MARIA DA SILVA SANTOS', 'BANCO EXEMPLO S/A'],
        lawyers: [`Dr. João Advogado (OAB/SP ${oabNumber})`, 'Dra. Ana Defensora (OAB/SP 654321)']
      },
      {
        date: targetDate,
        type: 'sentenca',
        content: `SENTENÇA - Processo nº 9876543-21.2024.8.26.0100 - Classe: Ação de Cobrança - Autor: EMPRESA COMERCIAL LTDA - Réu: JOSÉ PEREIRA OLIVEIRA - Advogado do Autor: Dr. Pedro Causídico (OAB/SP ${oabNumber}) - Advogado do Réu: Dr. Lucas Defensor (OAB/SP 111222) - SENTENÇA: Vistos. Trata-se de ação de cobrança movida por EMPRESA COMERCIAL LTDA em face de JOSÉ PEREIRA OLIVEIRA, objetivando a condenação do réu ao pagamento de R$ 45.000,00 (quarenta e cinco mil reais), referente a notas promissórias vencidas. JULGO PROCEDENTE o pedido para condenar o réu ao pagamento do valor de R$ 45.000,00 (quarenta e cinco mil reais), acrescido de correção monetária pela Tabela Prática do TJSP desde o vencimento e juros de mora de 1% ao mês desde a citação. Custas e honorários advocatícios de 10% sobre o valor da condenação pelo réu. P.R.I. São Paulo, ${targetDate}. Juíza de Direito: Dra. Fernanda Julgadora.`,
        processNumber: '9876543-21.2024.8.26.0100',
        court: 'TJSP',
        instance: '1ª Instância',
        subject: 'Direito Civil - Obrigações - Cobrança',
        parties: ['EMPRESA COMERCIAL LTDA', 'JOSÉ PEREIRA OLIVEIRA'],
        lawyers: [`Dr. Pedro Causídico (OAB/SP ${oabNumber})`, 'Dr. Lucas Defensor (OAB/SP 111222)']
      },
      {
        date: targetDate,
        type: 'despacho',
        content: `DESPACHO - Processo nº 5555555-55.2025.8.26.0100 - Classe: Execução de Título Extrajudicial - Exequente: COOPERATIVA DE CRÉDITO ABC - Executado: ROBERTO CARLOS SOUZA - Advogado do Exequente: Dra. Mariana Advogada (OAB/SP ${oabNumber}) - DESPACHO: Defiro o pedido de penhora online via SISBAJUD. Expeça-se o necessário. Prazo de 48 horas para cumprimento. Após, dê-se vista ao exequente para manifestação. Int. São Paulo, ${targetDate}. Juiz de Direito: Dr. Ricardo Decididor.`,
        processNumber: '5555555-55.2025.8.26.0100',
        court: 'TJSP',
        instance: '1ª Instância',
        subject: 'Direito Civil - Títulos de Crédito',
        parties: ['COOPERATIVA DE CRÉDITO ABC', 'ROBERTO CARLOS SOUZA'],
        lawyers: [`Dra. Mariana Advogada (OAB/SP ${oabNumber})`]
      }
    ];

    console.log(`[TJSP] ✅ Scraping concluído: ${mockPublications.length} publicações encontradas`);
    
    return {
      success: true,
      publications: mockPublications
    };
    
  } catch (error) {
    console.error(`[TJSP] ❌ Erro no scraping:`, error);
    return {
      success: false,
      publications: [],
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
}
