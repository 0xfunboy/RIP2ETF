import type { IAgentRuntime, Media, Memory, Provider, State } from '@elizaos/core';
import { addHeader } from '@elizaos/core';

const buildInstructionBlock = (userQuestion: string, summary: string) => {
  const sections: string[] = [];

  const cleanedQuestion = userQuestion?.trim();
  if (cleanedQuestion) {
    sections.push(addHeader('# Richiesta utente', cleanedQuestion));
  }

  sections.push(
    addHeader(
      '# Dati disponibili dalle API rip2etf (usa questi numeri come fonte principale)',
      summary.trim()
    )
  );

  sections.push(
    addHeader(
      '# Istruzioni vincolanti per la risposta',
      [
        '- Fornisci un commento completo e analitico: cita issuer, TER, holdings principali, performance e differenze tra i ticker.',
        "- Collega l'analisi ai vincoli espliciti dell'utente (es. orizzonte lungo termine per figlio, profilo di rischio, scenari multi-valuta).",
        '- Metti in evidenza pro/contro di ciascun ETF e suggerisci eventuali azioni pragmatiche (accumulo periodico, diversificazione, verifica fiscale).',
        "- Menziona sempre il grafico Chart.js allegato (es. 'vedi grafico allegato per il confronto dei rendimenti').",
        '- Se qualche dato è assente o stimato, dichiaralo e indica quali informazioni aggiuntive sarebbero utili.',
        '- Mantieni il tono di Mr. RIP: pragmatico, antifuffa, trasparente sulle ipotesi.',
      ].join('\n')
    )
  );

  return sections.join('\n\n');
};

export const snapshotProvider: Provider = {
  name: 'RIP2ETF_SNAPSHOT',
  description:
    'Contestualizza le richieste ETF con i dati più recenti del plugin rip2etf e istruzioni di risposta.',
  dynamic: true,
  get: async (_runtime: IAgentRuntime, message: Memory, state: State) => {
    const summary = typeof state?.values?.snapshotSummary === 'string' ? state.values.snapshotSummary : '';
    if (!summary) {
      return {
        text: '',
        data: {},
        values: {},
      };
    }

    const userQuestion = typeof message?.content?.text === 'string' ? message.content.text : '';
    const attachments = Array.isArray(state?.values?.snapshotAttachments)
      ? (state.values.snapshotAttachments as Media[])
      : [];

    const providerText = buildInstructionBlock(userQuestion, summary);

    return {
      text: providerText,
      data: {
        snapshotSummary: summary,
        userQuestion,
        attachmentCount: attachments.length,
      },
      values: {
        snapshotSummary: summary,
        snapshotAttachments: attachments,
      },
    };
  },
};
