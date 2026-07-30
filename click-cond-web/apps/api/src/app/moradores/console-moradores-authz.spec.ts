import { ForbiddenException } from '@nestjs/common';
import { MoradoresController } from './moradores.controller';
import { MoradoresService } from './moradores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `condominios/:idCondominio/moradores` é o console da portaria: cadastro do
 * prédio inteiro, com nome, CPF, telefone, e-mail e unidade. O TenantGuard
 * confere o condomínio da rota, mas morador também pertence a ele.
 *
 * A rota mais crítica era `POST /link-user`, que nem recebia o usuário
 * autenticado. Ela cria a linha em Apartamentos_Users — a tabela pela qual
 * TODO o isolamento do sistema decide de quem é cada apartamento. Um morador
 * vinculava a si mesmo a qualquer unidade e passava a enxergar visitantes,
 * financeiro e histórico do vizinho: uma chave-mestra que anulava as demais
 * regras, por mais corretas que fossem.
 */
describe('Console de moradores — exige operador', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiro: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const service: any = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => ({ id: 5, id_condominio: 1 })),
      atividade: jest.fn(async () => ({})),
      exportExcel: jest.fn(async () => Buffer.from('')),
      listSindicosCondominio: jest.fn(async () => []),
      importBulk: jest.fn(async () => ({ ok: true })),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => ({ success: true })),
      linkExistingUser: jest.fn(async () => ({ ok: true })),
      sendCredentials: jest.fn(async () => ({ ok: true })),
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    return { ctrl: new MoradoresController(service, tenant), service };
  }

  it('NEGA morador vincular usuário a apartamento (escalada de privilégio)', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.linkUser(1, { id_user: 10, id_apartamento: 99 }, morador))
      .toThrow(ForbiddenException);
    expect(service.linkExistingUser).not.toHaveBeenCalled();
  });

  it('NEGA morador listar o cadastro do prédio', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('NEGA morador exportar a planilha de moradores', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.exportExcel(1, morador)).toThrow(ForbiddenException);
    expect(service.exportExcel).not.toHaveBeenCalled();
  });

  it('NEGA morador abrir a ficha de outro morador', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.get(5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('NEGA morador ver o dossiê de atividade de outro morador', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.atividade(5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.atividade).not.toHaveBeenCalled();
  });

  it('NEGA morador criar, editar e remover morador', async () => {
    const { ctrl, service } = build();
    expect(() => ctrl.create(1, { nome: 'X' } as any, morador)).toThrow(ForbiddenException);
    await expect(ctrl.update(5, { nome: 'X' }, morador)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.remove(5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('NEGA morador importar moradores em massa', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.importBulk(1, { linhas: [] }, morador)).toThrow(ForbiddenException);
    expect(service.importBulk).not.toHaveBeenCalled();
  });

  it('NEGA morador disparar credenciais de acesso de outro', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.sendCredentials(5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.sendCredentials).not.toHaveBeenCalled();
  });

  describe('quem opera o console continua passando', () => {
    it('porteiro da portaria-web lista e vincula', async () => {
      const { ctrl, service } = build();
      await ctrl.list(1, porteiro);
      ctrl.linkUser(1, { id_user: 10, id_apartamento: 3 }, porteiro);
      expect(service.findAll).toHaveBeenCalled();
      expect(service.linkExistingUser).toHaveBeenCalled();
    });

    it('síndico do app envia credenciais (única rota daqui que o app usa)', async () => {
      const { ctrl, service } = build();
      await ctrl.sendCredentials(5, sindico);
      expect(service.sendCredentials).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('espera o service e propaga a falha em vez de responder ok', async () => {
      const { ctrl, service } = build();
      service.remove = jest.fn(async () => {
        throw new Error('constraint');
      });
      await expect(ctrl.remove(5, porteiro)).rejects.toThrow('constraint');
    });
  });
});

describe('MoradoresService.linkExistingUser — defesa em profundidade', () => {
  it('recusa mesmo se algum chamador futuro esquecer a checagem no controller', async () => {
    const svc = new MoradoresService({} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      svc.linkExistingUser(1, { id_user: 10, id_apartamento: 3 }, { sub: 10, nome: 'M', typeAccess: 'Morador' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
