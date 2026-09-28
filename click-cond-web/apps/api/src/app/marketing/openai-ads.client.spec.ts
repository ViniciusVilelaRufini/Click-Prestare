import { janelasOpenAi } from './openai-ads.client';

describe('janelasOpenAi', () => {
  // 2026-09-27 23:40 em Brasília = 2026-09-28T02:40:00Z
  const agora = new Date('2026-09-28T02:40:00Z');

  it('insights terminam na última hora cheia (nunca no futuro)', () => {
    const j = janelasOpenAi(agora, 7);
    expect(j.insights.end).toBe(Date.parse('2026-09-28T02:00:00Z') / 1000);
  });

  it('tudo começa na meia-noite de Brasília N dias antes de hoje', () => {
    const j = janelasOpenAi(agora, 7);
    expect(j.insights.start).toBe(Date.parse('2026-09-20T03:00:00Z') / 1000);
    expect(j.conversoes.start).toBe(j.insights.start);
  });

  it('conversões terminam na meia-noite local de hoje', () => {
    const j = janelasOpenAi(agora, 7);
    expect(j.conversoes.end).toBe(Date.parse('2026-09-27T03:00:00Z') / 1000);
  });

  it('logo depois da meia-noite local, hoje já é o dia novo', () => {
    const j = janelasOpenAi(new Date('2026-09-28T03:10:00Z'), 1);
    expect(j.conversoes.end).toBe(Date.parse('2026-09-28T03:00:00Z') / 1000);
    expect(j.insights.end).toBe(Date.parse('2026-09-28T03:00:00Z') / 1000);
  });
});
