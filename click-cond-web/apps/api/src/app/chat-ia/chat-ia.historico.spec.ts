import { ChatIaService } from './chat-ia.service';

/**
 * O generateContent exige turnos alternando user/model, começando em user.
 * O histórico gravado não garante isso, e uma violação faz o Gemini responder
 * 400 — derrubando a conversa inteira, não só aquele turno.
 *
 * O caso da primeira suíte é o histórico REAL que estava em produção
 * (cond#1 / user#47) e que deixou o assistente mudo depois que o histórico
 * passou a ser enviado como turnos de conversa em vez de um bloco de texto.
 */
describe('ChatIaService — normalização do histórico', () => {
  // normalizarHistorico é privado; o teste exercita o comportamento por acesso
  // direto, que é o que importa travar aqui.
  const svc = new ChatIaService({} as any, {} as any, {} as any);
  const normalizar = (h: { papel: string; mensagem: string }[]) =>
    (svc as any).normalizarHistorico(h) as { role: string; parts: { text: string }[] }[];

  const roles = (h: { papel: string; mensagem: string }[]) =>
    normalizar(h).map((t) => t.role);

  /** Toda saída precisa alternar e começar em user. */
  function assertValido(saida: { role: string }[]) {
    if (saida.length === 0) return;
    expect(saida[0].role).toBe('user');
    for (let i = 1; i < saida.length; i++) {
      expect(saida[i].role).not.toBe(saida[i - 1].role);
    }
    // Termina em model para que a pergunta atual (user) alterne corretamente.
    expect(saida[saida.length - 1].role).toBe('model');
  }

  it('conserta o histórico real de produção que quebrou o assistente', () => {
    // user -> model -> model -> user -> model -> user  (duas violações)
    const producao = [
      { papel: 'user', mensagem: 'Quem trabalha na portaria?' },
      { papel: 'assistant', mensagem: 'A pessoa cadastrada na portaria é...' },
      { papel: 'assistant', mensagem: 'Não encontrei a informação sobre a quantidade...' },
      { papel: 'user', mensagem: 'quantos moradores possui no condominio' },
      { papel: 'assistant', mensagem: '3:52:14, saída 04/07/2026...' },
      { papel: 'user', mensagem: 'Quais visitas estão agendadas para o meu apartamento?' },
    ];
    const saida = normalizar(producao);
    assertValido(saida);
    expect(roles(producao)).toEqual(['user', 'model', 'user', 'model']);
  });

  it('descarta turnos "model" no início (não pode começar por model)', () => {
    const h = [
      { papel: 'assistant', mensagem: 'sobrou do turno anterior' },
      { papel: 'user', mensagem: 'oi' },
      { papel: 'assistant', mensagem: 'olá' },
    ];
    expect(roles(h)).toEqual(['user', 'model']);
    assertValido(normalizar(h));
  });

  it('colapsa turnos consecutivos do mesmo lado mantendo o mais recente', () => {
    const h = [
      { papel: 'user', mensagem: 'primeira' },
      { papel: 'assistant', mensagem: 'resposta antiga' },
      { papel: 'assistant', mensagem: 'resposta nova' },
    ];
    const saida = normalizar(h);
    expect(saida.map((t) => t.role)).toEqual(['user', 'model']);
    expect(saida[1].parts[0].text).toBe('resposta nova');
  });

  it('remove pergunta órfã no fim para não gerar user -> user', () => {
    const h = [
      { papel: 'user', mensagem: 'oi' },
      { papel: 'assistant', mensagem: 'olá' },
      { papel: 'user', mensagem: 'pergunta que nunca foi respondida' },
    ];
    expect(roles(h)).toEqual(['user', 'model']);
  });

  it('ignora mensagens vazias', () => {
    const h = [
      { papel: 'user', mensagem: 'oi' },
      { papel: 'assistant', mensagem: '   ' },
      { papel: 'assistant', mensagem: 'olá' },
    ];
    const saida = normalizar(h);
    expect(saida.map((t) => t.role)).toEqual(['user', 'model']);
    expect(saida[1].parts[0].text).toBe('olá');
  });

  it('histórico vazio devolve lista vazia', () => {
    expect(normalizar([])).toEqual([]);
  });

  it('histórico só com uma pergunta sem resposta devolve vazio', () => {
    expect(normalizar([{ papel: 'user', mensagem: 'oi' }])).toEqual([]);
  });

  it('qualquer sequência aleatória sai válida', () => {
    const papeis = ['user', 'assistant'];
    for (let n = 0; n < 60; n++) {
      const h = Array.from({ length: 1 + (n % 8) }, (_, i) => ({
        papel: papeis[(n * 7 + i * 3) % 2],
        mensagem: `msg ${i}`,
      }));
      assertValido(normalizar(h));
    }
  });
});
