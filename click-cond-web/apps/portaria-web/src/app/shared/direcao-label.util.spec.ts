import { direcaoLabel } from './direcao-label.util';

/**
 * Usada pelo Dashboard e por Relatórios para o selo (badge) de eventos.
 * Eventos de status de dispositivo ("O dispositivo X ficou offline"/"voltou
 * a ficar online") vinham com direcao 'saida'/'entrada' herdada da lógica de
 * acesso de pessoas, fazendo o selo mostrar Entrada/Saída (ou, em
 * Relatórios, "Bloqueado" — já que o template só conhecia entrada/saida/
 * bloqueado). Eles têm selo próprio: Offline/Online.
 */
describe('direcaoLabel', () => {
  it('evento de dispositivo offline mostra selo "Offline", não "Saída"/"Bloqueado"', () => {
    expect(direcaoLabel('offline', 'Ocorrência')).toBe('Offline');
  });

  it('evento de dispositivo online mostra selo "Online", não "Entrada"/"Bloqueado"', () => {
    expect(direcaoLabel('online', 'Ocorrência')).toBe('Online');
  });

  it('acesso real de pessoa continua mostrando Entrada/Saída', () => {
    expect(direcaoLabel('entrada', 'Acesso Facial')).toBe('Entrada');
    expect(direcaoLabel('saida', 'Acesso Facial')).toBe('Saída');
  });

  it('acesso negado/bloqueado continua mostrando "Bloqueado"', () => {
    expect(direcaoLabel('negado', 'Acesso Facial')).toBe('Bloqueado');
    expect(direcaoLabel('bloqueado', 'Acesso Facial')).toBe('Bloqueado');
  });

  it('sem direção definida, cai no tipo do evento (ex.: Encomenda)', () => {
    expect(direcaoLabel(undefined, 'Encomenda')).toBe('Encomenda');
    expect(direcaoLabel(null, 'Encomenda')).toBe('Encomenda');
  });
});
