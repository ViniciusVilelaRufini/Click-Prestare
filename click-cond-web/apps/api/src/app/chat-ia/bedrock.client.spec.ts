import { daResposta, paraFerramentas, paraJsonSchema, paraMensagens } from './bedrock.client';

describe('BedrockClient — tradução Gemini → Messages API', () => {
  it('schema com type em maiúsculas vira JSON Schema', () => {
    expect(
      paraJsonSchema({ type: 'OBJECT', properties: { data: { type: 'STRING' }, ok: { type: 'BOOLEAN' } }, required: ['data'] }),
    ).toEqual({ type: 'object', properties: { data: { type: 'string' }, ok: { type: 'boolean' } }, required: ['data'] });
  });

  it('ferramenta sem parâmetros ganha schema de objeto vazio', () => {
    expect(paraFerramentas([{ name: 'avisos', description: 'Lista avisos' }])).toEqual([
      { name: 'avisos', description: 'Lista avisos', input_schema: { type: 'object', properties: {} } },
    ]);
  });

  it('imagem e PDF anexados viram blocos image/document; texto vazio some', () => {
    const msgs = paraMensagens([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: 'AAA' } },
          { inlineData: { mimeType: 'application/pdf', data: 'BBB' } },
          { text: '   ' },
          { text: 'leia a conta' },
        ],
      },
    ]);
    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
          { type: 'text', text: 'leia a conta' },
        ],
      },
    ]);
  });

  it('turno do modelo é reenviado intacto e os resultados casam com o id do tool_use na ordem', () => {
    const turnoModelo = daResposta(
      [
        { type: 'thinking', thinking: '', signature: 'sig' } as any,
        { type: 'tool_use', id: 'toolu_1', name: 'avisos', input: {} } as any,
        { type: 'tool_use', id: 'toolu_2', name: 'reservas', input: { dia: 'hoje' } } as any,
      ],
      'tool_use',
    );
    expect(turnoModelo.chamadas).toEqual([
      { name: 'avisos', args: {} },
      { name: 'reservas', args: { dia: 'hoje' } },
    ]);

    const msgs = paraMensagens([
      { role: 'user', parts: [{ text: 'o que tem hoje?' }] },
      { role: 'model', parts: turnoModelo.partesModelo },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'avisos', response: { result: ['aviso A'] } } },
          { functionResponse: { name: 'reservas', response: { result: [] } } },
        ],
      },
    ]);

    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'avisos', input: {} },
        { type: 'tool_use', id: 'toolu_2', name: 'reservas', input: { dia: 'hoje' } },
      ],
    });
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '["aviso A"]' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: '[]' },
      ],
    });
  });

  it('histórico em texto vira user/assistant', () => {
    expect(
      paraMensagens([
        { role: 'user', parts: [{ text: 'oi' }] },
        { role: 'model', parts: [{ text: 'olá!' }] },
        { role: 'user', parts: [{ text: 'tudo bem?' }] },
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'oi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'olá!' }] },
      { role: 'user', content: [{ type: 'text', text: 'tudo bem?' }] },
    ]);
  });

  it('resposta final junta os textos; recusa não vaza o conteúdo', () => {
    const final = daResposta([{ type: 'text', text: 'Há 2 avisos. ' } as any, { type: 'text', text: 'Quer ver?' } as any], 'end_turn');
    expect(final.texto).toBe('Há 2 avisos. Quer ver?');
    expect(final.chamadas).toEqual([]);
    expect(daResposta([{ type: 'text', text: 'x' } as any], 'refusal').texto).toBe('Não posso ajudar com esse pedido.');
  });
});
