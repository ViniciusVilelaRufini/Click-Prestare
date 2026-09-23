import { ForbiddenException } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';

/**
 * /condominios/:id/encomendas é a superfície da portaria-web. O TenantGuard
 * só confere o vínculo com o condomínio — e morador tem vínculo. Sem checagem
 * de papel, qualquer morador listava as encomendas do prédio inteiro (apto,
 * descrição, quem retirou) e dava baixa ou apagava a de outro apartamento.
 * O app do morador usa as rotas próprias em /encomendas/* (mobile-auth).
 */
describe('Encomendas (console) — exige operador', () => {
  const morador = { sub: 50, nome: 'QA_SECURITY_20260923 morador', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'QA porteiro', id_condominio: 1 } as any;

  function montar() {
    const service: any = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
      retirar: jest.fn(async () => ({})),
      notificar: jest.fn(async () => ({})),
      receber: jest.fn(async () => ({})),
      remove: jest.fn(async () => ({})),
    };
    return { service, ctrl: new EncomendasController(service) };
  }

  const chamadas: Array<[string, (c: EncomendasController, u: any) => unknown]> = [
    ['findAll', (c, u) => c.list(1, undefined, u)],
    ['findOne', (c, u) => c.get(9, u)],
    ['create', (c, u) => c.create(1, {} as any, u)],
    ['retirar', (c, u) => c.retirar(9, { retirado_por: 'x' }, u)],
    ['notificar', (c, u) => c.notificar(9, u)],
    ['receber', (c, u) => c.receber(9, u)],
    ['remove', (c, u) => c.remove(9, u)],
  ];

  it.each(chamadas)('morador é recusado (%s)', async (metodo, chamar) => {
    const { ctrl, service } = montar();
    await expect(Promise.resolve().then(() => chamar(ctrl, morador))).rejects.toBeInstanceOf(ForbiddenException);
    expect(service[metodo]).not.toHaveBeenCalled();
  });

  it.each(chamadas)('porteiro continua podendo (%s)', async (metodo, chamar) => {
    const { ctrl, service } = montar();
    await chamar(ctrl, porteiro);
    expect(service[metodo]).toHaveBeenCalled();
  });
});

/**
 * Mesma falha nas rotas do app: insert/update/remove chamavam o service só
 * com checagem de condomínio. No app essas ações são de síndico/funcionário
 * (a tela do morador não mostra os botões), mas um morador chamando a API
 * editava ou apagava a encomenda de qualquer apartamento.
 */
describe('Encomendas (app) — insert/update/remove exigem operador', () => {
  const { EncomendasMobileController } = jest.requireActual('../auth/mobile-auth.controller');
  const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any;
  const sindico = { sub: 7, nome: 'QA síndico', typeAccess: 'Sindico' } as any;

  function montar() {
    const enc: any = {
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => ({})),
    };
    return { enc, ctrl: new EncomendasMobileController({} as any, enc) };
  }

  const chamadas: Array<[string, (c: any, u: any) => unknown]> = [
    ['create', (c, u) => c.insert(u, { id_condominio: 1, descricao: 'x', destinatario_apto: '101' })],
    ['update', (c, u) => c.update(u, { id: 9, descricao: 'x' })],
    ['remove', (c, u) => c.remove(u, { id: 9 })],
  ];

  it.each(chamadas)('morador é recusado (%s)', async (metodo, chamar) => {
    const { ctrl, enc } = montar();
    await expect(Promise.resolve().then(() => chamar(ctrl, morador))).rejects.toBeInstanceOf(ForbiddenException);
    expect(enc[metodo]).not.toHaveBeenCalled();
  });

  it.each(chamadas)('síndico continua podendo (%s)', async (metodo, chamar) => {
    const { ctrl, enc } = montar();
    await chamar(ctrl, sindico);
    expect(enc[metodo]).toHaveBeenCalled();
  });
});
