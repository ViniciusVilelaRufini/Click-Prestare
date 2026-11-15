import { readFileSync } from 'fs';
import { join } from 'path';
import { TOLERANCIA_JANELA_MS, ehAutorizacaoRemota, prazoAutorizacaoRemotaMs } from './janela-visita';
import { TOLERANCIA_JANELA_MS as DE_VISITANTES } from '../visitantes/visitantes.service';

/**
 * Rodada 4, item 4: a tolerância de 15 min depois do fim da janela tinha cinco
 * cópias locais no facial (GRACE / GRACE_PERIOD_MS) além da de visitantes.
 * Agora é uma constante só, em common/, sem mudança de valor.
 */
describe('janela da visita — constante única e autorização remota', () => {
  it('a tolerância continua 15 min e visitantes reexporta a mesma', () => {
    expect(TOLERANCIA_JANELA_MS).toBe(15 * 60 * 1000);
    expect(DE_VISITANTES).toBe(TOLERANCIA_JANELA_MS);
  });

  it('o facial não declara cópia local da tolerância', () => {
    const fonte = readFileSync(join(__dirname, '..', 'facial', 'facial.service.ts'), 'utf8');
    expect(fonte).not.toMatch(/const\s+GRACE(_PERIOD_MS)?\s*=/);
  });

  describe('autorização remota', () => {
    const respondida = new Date('2026-11-14T12:00:00Z');
    const base = { auth_status: 'autorizado', auth_respondido_em: respondida, auth_respondido_por: 77, data_entrada: null };

    it('resposta do morador (Users.id) a um pedido: 10 min depois da resposta', () => {
      expect(ehAutorizacaoRemota(base)).toBe(true);
      expect(prazoAutorizacaoRemotaMs(base)).toBe(respondida.getTime() + 10 * 60 * 1000);
    });

    it('pedido resolvido pelo porteiro (sem Users.id) não é remota', () => {
      expect(ehAutorizacaoRemota({ ...base, auth_respondido_por: null })).toBe(false);
    });

    it('sem pedido (pré-autorização, recorrente, prestador, cadastrar e liberar) não é remota', () => {
      expect(prazoAutorizacaoRemotaMs({ ...base, auth_status: null })).toBeNull();
    });

    it('depois que a pessoa entrou por ela, o prazo deixa de se aplicar', () => {
      expect(prazoAutorizacaoRemotaMs({ ...base, data_entrada: new Date('2026-11-14T12:05:00Z') })).toBeNull();
    });
  });
});
