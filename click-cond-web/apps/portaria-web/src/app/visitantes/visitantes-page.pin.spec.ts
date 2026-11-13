import { VisitantesPageComponent } from './visitantes-page.component';

/**
 * Validar PIN de quem está DENTRO serve para a saída. A API já aceita a saída
 * depois do fim da janela, mas o botão "Confirmar Saída" ficava desabilitado
 * quando `status_vigencia` vinha "EXPIRADO", e o selo dizia "EXPIRADO".
 */
describe('VisitantesPageComponent — Validar PIN para a saída', () => {
  const tela = Object.create(VisitantesPageComponent.prototype) as VisitantesPageComponent;
  const entrou = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  it('dentro: o botão de saída fica habilitado mesmo com vigência expirada', () => {
    expect(tela.pinRecusado({ data_entrada: entrou, status_vigencia: 'EXPIRADO' })).toBe(false);
    expect(tela.pinRecusado({ data_entrada: entrou, status_vigencia: 'SAIDA', acao: 'saida' })).toBe(false);
  });

  it('fora com vigência expirada: entrada continua bloqueada', () => {
    expect(tela.pinRecusado({ data_entrada: null, status_vigencia: 'EXPIRADO' })).toBe(true);
    expect(tela.pinRecusado({ data_entrada: null, status_vigencia: 'ATIVO' })).toBe(false);
  });

  it('selo: "Registrar saída" para quem está dentro; senão a vigência', () => {
    expect(tela.rotuloVigenciaPin({ data_entrada: entrou, status_vigencia: 'SAIDA', acao: 'saida' })).toBe('Registrar saída');
    expect(tela.rotuloVigenciaPin({ data_entrada: null, status_vigencia: 'ATIVO', acao: 'entrada' })).toBe('ATIVO');
  });
});
