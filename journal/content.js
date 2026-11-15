export const modes={
light:{title:'Light day',time:'5–10 minutes',tasks:[['Duolingo','Complete your daily lesson. Record the minutes in the Duolingo panel or with this session.'],['TV5MONDE listening','Do one short A2 listening exercise. Focus on the overall meaning.']]},
standard:{title:'Standard day',time:'About 20 minutes',tasks:[['Duolingo','5–7 minutes of grammar and vocabulary.'],['TV5MONDE lesson','8–10 minutes: listen, answer, check transcript, replay.'],['Active recall','3–5 minutes: say or write a few sentences using new expressions.']]},
intensive:{title:'Intensive day',time:'30–45 minutes',tasks:[['Duolingo','5–7 minutes of grammar and vocabulary.'],['TV5MONDE or curated video','10–15 minutes of focused listening and transcript review.'],['Speaking','10–15 minutes of AI or human conversation.'],['Review','5 minutes: note corrections and save useful phrases.']]}
};

export const prompts={A2:['Raconte-moi ce que tu as fait hier et ce que tu as prévu pour demain.','Décris ton quartier. Qu’est-ce que tu aimes et qu’est-ce que tu voudrais changer ?','Parle-moi d’un film, d’une série ou d’un livre que tu as aimé.','Qu’est-ce que tu fais pour rester en bonne santé ?','Décris une journée idéale pour toi.'],B1:['Penses-tu que les réseaux sociaux rapprochent les gens ou les isolent ? Pourquoi ?','Raconte une décision difficile que tu as prise et explique ses conséquences.','Quels sont les avantages et les inconvénients du télétravail ?','Comment la technologie transforme-t-elle notre façon d’apprendre ?','Si tu pouvais changer une chose dans ton système éducatif, que changerais-tu ?'],B2:['Dans quelle mesure l’intelligence artificielle risque-t-elle de transformer le marché du travail ?','Le bilinguisme devrait-il être une exigence pour certains emplois au Canada ? Défends ton point de vue.','La croissance économique est-elle toujours compatible avec la protection de l’environnement ?','Comment distinguer la liberté individuelle de la responsabilité collective ?','Les études universitaires préparent-elles suffisamment les jeunes au monde professionnel ?']};


export const phases = [
  { level: 'A1', title: 'Get started', skills: ['Understand basic greetings and numbers', 'Introduce myself and ask simple questions', 'Write a short personal message'] },
  { level: 'A2', title: 'Build the base', skills: ['Get the gist of a short, clear clip', 'Talk about yesterday and tomorrow', 'Write a short message about a familiar topic'] },
  { level: 'B1', title: 'Become independent', skills: ['Follow the main points of a clear podcast', 'Explain an opinion with reasons', 'Write a connected account of an experience'] },
  { level: 'B1+', title: 'Build range', skills: ['Follow parts of a native interview without subtitles', 'Summarize a Radio-Canada segment', 'Respond to a different point of view'] },
  { level: 'B2', title: 'Use French confidently', skills: ['Follow an extended argument on a familiar issue', 'Discuss a professional topic with some spontaneity', 'Write a clear case for and against a position'] }
];

export const workflow = ['First listen', 'Comprehension', 'Transcript', 'Replay', 'Active use'];
