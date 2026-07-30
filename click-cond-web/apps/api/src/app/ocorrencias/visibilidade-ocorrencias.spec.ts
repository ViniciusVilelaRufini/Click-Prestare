import { ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { TagsController } from '../veiculos/tags.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

/**
 * A regra de visibilidade de ocorrência já existia — `assertPodeVer`, usada no
 * `findOne`: staff vê tudo, morador vê as públicas e as que ele mesmo abriu.
 *
 * Só que a LISTAGEM não aplicava nada: devolvia todas as ocorrências do
 * condomínio, inclusive as privadas, com descrição e nome de quem abriu. Num
 * condomínio, ocorrência costuma ser reclamação — muitas vezes sobre o
 * vizinho.
 */
describe('OcorrenciasService.findAll — respeita público/privado', () => {
  function build() {
    let whereUsado: any = null;
    const prisma: any = {
      ocorrencias: {
        findMany: jest.fn(async ({ where }: any) => {
          whereUsado = where;
          return [];
        }),
      },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
      users: { findMany: jest.fn(async () => []) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, {} as any, {} as any, tenant);
    return { svc, whereUsado: () => whereUsado };
  }

  it('morador recebe só as públicas e as próprias', async () => {
    const { svc, whereUsado } = build();
    await svc.findAll(1, undefined, morador);
    expect(whereUsado().OR).toEqual([{ publica: true }, { user: 50 }]);
  });

  it('síndico vê todas', async () => {
    const { svc, whereUsado } = build();
    await svc.findAll(1, undefined, sindico);
    expect(whereUsado().OR).toBeUndefined();
  });

  it('porteiro do console vê todas', async () => {
    const { svc, whereUsado } = build();
    await svc.findAll(1, undefined, porteiro);
    expect(whereUsado().OR).toBeUndefined();
  });

  it('o filtro de status continua funcionando junto com o recorte', async () => {
    const { svc, whereUsado } = build();
    await svc.findAll(1, 'pendente', morador);
    expect(whereUsado().status).toBe('pendente');
    expect(whereUsado().OR).toEqual([{ publica: true }, { user: 50 }]);
  });
});

/**
 * Tags são credenciais físicas (RFID). O módulo não tinha autorização nenhuma
 * — nem no controller nem no service. Um morador listava TODOS os códigos do
 * prédio (com o código, clona-se o cartão) e podia criar tags. Pior: o ramo
 * `update` do upsert faz `ativo: 1`, então repostar o código de uma tag
 * revogada — cartão perdido ou roubado — a REATIVAVA.
 */
describe('TagsController — credencial de acesso exige operador', () => {
  function build() {
    const service: any = {
      findAll: jest.fn(async () => []),
      upsert: jest.fn(async () => ({})),
    };
    return { ctrl: new TagsController(service), service };
  }

  it('NEGA morador listar os códigos de tag do prédio', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('NEGA morador criar (ou reativar) tag', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.create(1, { codigo: 'ABC123' }, morador)).toThrow(ForbiddenException);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('PERMITE a portaria, que é quem captura a tag no leitor', () => {
    const { ctrl, service } = build();
    ctrl.list(1, porteiro);
    ctrl.create(1, { codigo: 'ABC123' }, porteiro);
    expect(service.findAll).toHaveBeenCalled();
    expect(service.upsert).toHaveBeenCalled();
  });
});
