import { VisitantesPageComponent } from './visitantes-page.component';

/** Situação de cada unidade no modal "Registrar Entrada", em texto claro. */
describe('VisitantesPageComponent.situacaoUnidade', () => {
  const tela = Object.create(VisitantesPageComponent.prototype) as VisitantesPageComponent;
  it.each([
    // `liberado` sozinho é um bucket ambíguo: tanto o cadastro pela
    // portaria/síndico em "Registrar nova visita" (create/
    // createViaPessoasVisitas na API grava liberado:1 sem tocar
    // auth_status) quanto a reserva de vaga pelo morador para o visitante
    // (mobile-auth.service.ts ~5036-5058, idem) caem aqui — nenhum campo
    // separa os dois casos, então o texto é neutro em vez de arriscar
    // atribuir a liberação a quem não liberou.
    [{ liberado: true }, 'Liberado', 'ok'],
    [{ liberado: true, auth_status: 'autorizado' }, 'Liberado pelo morador', 'ok'],
    [{ auth_status: 'autorizado' }, 'Liberado pelo morador', 'ok'],
    [{ auth_status: 'pendente' }, 'Aguardando o morador', 'aviso'],
    [{ autorizacao_expirada: true }, 'Autorização expirada', 'aviso'],
    [{ noLocal: true }, 'Dentro do condomínio', 'info'],
    [{}, 'Sem autorização ativa', 'neutro'],
  ])('%o → %s', (apto, texto, tom) => {
    expect(tela.situacaoUnidade(apto as any)).toEqual({ texto, tom });
  });
});
