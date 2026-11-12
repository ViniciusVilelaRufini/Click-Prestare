import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { OcorrenciasService } from './ocorrencias.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { OcorrenciasMobileController } from '../auth/mobile-auth.controller';
import { MobileAuthService } from '../auth/mobile-auth.service';

/**
 * O app chama POST ocorrencias/update (edição do autor e resposta da equipe)
 * e POST ocorrencias/remove, que não existiam no NestJS (404). E o insert
 * ignorava os anexos (`docs`). Aqui ficam as regras de quem pode o quê:
 *  - editar: só o autor, só enquanto Pendente;
 *  - responder: síndico/funcionário com a flag `ocorrencias`, do condomínio;
 *  - excluir: o autor enquanto Pendente, ou o síndico do condomínio;
 *  - nunca uma ocorrência de outro condomínio.
 */
describe('Ocorrências no app — editar, excluir, responder e anexos', () => {
  const COND = 1;
  const OUTRO_COND = 2;
  const URL_1 = 'https://bucket.s3.amazonaws.com/ocorrencias/1-a.jpg';
  const URL_2 = 'https://bucket.s3.amazonaws.com/ocorrencias/2-b.jpg';
  const URL_3 = 'https://bucket.s3.amazonaws.com/ocorrencias/3-c.jpg';
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const PDF = 'data:application/pdf;base64,JVBERi0=';

  const autor = { sub: 100, typeAccess: 'Morador', user: { id: 100 } } as any;
  const vizinho = { sub: 101, typeAccess: 'Morador', user: { id: 101 } } as any;
  const sindico = { sub: 7, typeAccess: 'Sindico', user: { id: 7 } } as any;
  const funcionario = { sub: 20, typeAccess: 'Funcionario', user: { id: 20 } } as any;

  function montar(opts: { oc?: any; flag?: number; uploads?: (string | null)[]; corrida?: boolean } = {}) {
    const oc = {
      id: 5,
      id_condominio: COND,
      user: 100,
      status: 'Pendente',
      tipo: 1,
      publica: false,
      anexos: 'https://bucket.s3.amazonaws.com/ocorrencias/0-antigo.jpg',
      ...(opts.oc ?? {}),
    };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: opts.flag ?? 1 })) },
      ocorrencias: {
        findUnique: jest.fn(async () => oc),
        create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
        delete: jest.fn(async () => ({})),
        // Escrita do autor: condicionada a Pendente. `count` 0 simula a corrida.
        updateMany: jest.fn(async () => ({ count: opts.corrida ? 0 : 1 })),
        deleteMany: jest.fn(async () => ({ count: opts.corrida ? 0 : 1 })),
      },
      ocorrencias_Categorias: {
        findUnique: jest.fn(async ({ where }: any) => ({ sla_horas: where.id === 2 ? 4 : null })),
      },
      users: { findUnique: jest.fn(async () => null) },
    };
    // Tenant: a sessão só pertence ao condomínio 1. Funcionário passa pela
    // regra real da flag (Funcionarios.ocorrencias).
    const real = new TenantAccessService(prisma);
    const negaOutro = async (idCond: number) => {
      if (Number(idCond) !== COND) throw new ForbiddenException('Acesso negado: condomínio inválido.');
    };
    const tenant: any = {
      assertEntidade: jest.fn(negaOutro),
      assertCondominio: jest.fn(negaOutro),
      assertPermissaoFuncionario: jest.fn((id: number, f: any, p: any) => real.assertPermissaoFuncionario(id, f, p)),
    };
    const fila = [...(opts.uploads ?? [URL_1, URL_2, URL_3])];
    const storage: any = {
      isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
      uploadDataUrl: jest.fn(async () => (fila.length ? fila.shift() : null)),
      exigirArquivoDoRegistro: jest.fn(async () => undefined),
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant, storage);
    const mobile = new MobileAuthService(
      prisma, {} as any, {} as any, storage, {} as any, tenant, {} as any, {} as any, {} as any, {} as any,
    );
    const ctrl = new OcorrenciasMobileController(mobile, svc);
    return { ctrl, svc, prisma, storage, tenant };
  }

  const edicao = (o: any = {}) => ({
    ocorrencia: { id: 5, descricao: 'Vazamento no 3º andar', tipo: '1', isResposta: false, publica: false, docs: [], ...o },
    id_condominio: String(COND),
  });
  const resposta = (o: any = {}) => ({
    ocorrencia: { id: 5, descricao: 'Encanador chamado', status: 'solucionado', isResposta: true, ...o },
    id_condominio: String(COND),
  });

  async function erro(p: Promise<unknown> | unknown) {
    return Promise.resolve().then(() => p).catch((e) => e);
  }

  describe('rotas', () => {
    it('update e remove existem e respondem 200', () => {
      for (const m of ['update', 'remove']) {
        const fn = (OcorrenciasMobileController.prototype as any)[m];
        expect(typeof fn).toBe('function');
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, fn)).toBe(200);
      }
    });
  });

  describe('update do autor (isResposta=false)', () => {
    it('autor edita descrição, tipo e visibilidade da ocorrência pendente', async () => {
      const { ctrl, prisma } = montar();
      await ctrl.update(edicao({ descricao: '  Vazamento grave  ', tipo: '2', publica: true }), autor);
      expect(prisma.ocorrencias.updateMany).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.ocorrencias.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 5, user: 100, status: 'Pendente' });
      expect(data.descricao).toBe('Vazamento grave');
      expect(data.tipo).toBe(2);
      expect(data.publica).toBe(true);
      // Tipo mudou: prazo recalculado com o SLA da nova categoria (4 h).
      expect(data.prazo).toBeInstanceOf(Date);
      const horas = (data.prazo.getTime() - Date.now()) / 3600_000;
      expect(horas).toBeGreaterThan(3.9);
      expect(horas).toBeLessThanOrEqual(4);
    });

    it('mesmo tipo: prazo não muda', async () => {
      const { ctrl, prisma } = montar();
      await ctrl.update(edicao({ tipo: '1' }), autor);
      const { data } = prisma.ocorrencias.updateMany.mock.calls[0][0];
      expect('prazo' in data).toBe(false);
      expect('tipo' in data).toBe(false);
    });

    it('corrida: equipe deu ciência entre a leitura e o update -> 400 e nada é gravado', async () => {
      const { ctrl, prisma } = montar({ corrida: true });
      const e: any = await erro(ctrl.update(edicao(), autor));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toContain('já está em atendimento');
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    });

    it('não-autor recebe 403 e nada é gravado', async () => {
      const { ctrl, prisma, storage } = montar();
      const e = await erro(ctrl.update(edicao({ docs: [PNG] }), vizinho));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    });

    it('síndico não edita a ocorrência do morador pela rota do autor', async () => {
      const { ctrl, prisma } = montar();
      const e = await erro(ctrl.update(edicao(), sindico));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    });

    it('ocorrência já atendida (Ciente/Solucionado) não é editada', async () => {
      for (const status of ['Ciente', 'Solucionado']) {
        const { ctrl, prisma } = montar({ oc: { status } });
        const e: any = await erro(ctrl.update(edicao(), autor));
        expect(e).toBeInstanceOf(BadRequestException);
        expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
      }
    });

    it('ocorrência de outro condomínio: bloqueada, nada é gravado', async () => {
      const { ctrl, prisma, tenant } = montar({ oc: { id_condominio: OUTRO_COND } });
      const e = await erro(ctrl.update(edicao(), autor));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(tenant.assertEntidade).toHaveBeenCalledWith(OUTRO_COND, autor, expect.any(String));
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    });

    it('ocorrência inexistente: 404', async () => {
      const { ctrl, prisma } = montar();
      prisma.ocorrencias.findUnique.mockResolvedValueOnce(null);
      expect(await erro(ctrl.update(edicao(), autor))).toBeInstanceOf(NotFoundException);
    });

    it('descrição só com espaços: 400 "Descrição é obrigatória."', async () => {
      const { ctrl, prisma } = montar();
      const e: any = await erro(ctrl.update(edicao({ descricao: '   \n ' }), autor));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe('Descrição é obrigatória.');
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('anexos', () => {
    it('update com docs novos sobe as imagens e SUBSTITUI os anexos', async () => {
      const { ctrl, prisma, storage } = montar();
      await ctrl.update(edicao({ docs: [PNG, JPG] }), autor);
      expect(storage.uploadDataUrl).toHaveBeenCalledTimes(2);
      expect(storage.uploadDataUrl).toHaveBeenCalledWith(PNG, 'ocorrencias');
      expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data.anexos).toBe(`${URL_1};${URL_2}`);
    });

    it('update sem docs mantém os anexos atuais', async () => {
      const { ctrl, prisma, storage } = montar();
      await ctrl.update(edicao({ docs: [] }), autor);
      await ctrl.update(edicao({ docs: undefined }), autor);
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
      for (const c of prisma.ocorrencias.updateMany.mock.calls) expect('anexos' in c[0].data).toBe(false);
    });

    it('no máximo 3 imagens; PDF e texto não são anexados', async () => {
      const { ctrl, prisma, storage } = montar({ uploads: [URL_1, URL_2, URL_3, 'x', 'y'] });
      await ctrl.update(edicao({ docs: [PDF, PNG, 'nao-e-data-url', JPG, PNG, JPG, null] }), autor);
      expect(storage.uploadDataUrl).toHaveBeenCalledTimes(3);
      for (const c of storage.uploadDataUrl.mock.calls) expect(c[0]).not.toBe(PDF);
      expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data.anexos).toBe(`${URL_1};${URL_2};${URL_3}`);
    });

    it('URL enviada no lugar da imagem é ignorada (não vira anexo)', async () => {
      const { ctrl, prisma, storage } = montar();
      await ctrl.update(edicao({ docs: ['https://bucket.s3.amazonaws.com/moradores/alheia.jpg'] }), autor);
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
      expect('anexos' in prisma.ocorrencias.updateMany.mock.calls[0][0].data).toBe(false);
    });

    it('storage desligado/falhando: salva sem o arquivo, nunca 500', async () => {
      // Desligado devolve o próprio data URL; falha devolve null.
      const { ctrl, prisma } = montar({ uploads: [PNG, null] });
      await expect(ctrl.update(edicao({ docs: [PNG, JPG] }), autor)).resolves.toBeDefined();
      expect('anexos' in prisma.ocorrencias.updateMany.mock.calls[0][0].data).toBe(false);
    });

    it('insert sobe os anexos e grava separados por ";"', async () => {
      const { ctrl, prisma, storage } = montar();
      await ctrl.insert(
        { ocorrencia: { id: -1, descricao: 'Barulho', tipo: '1', isResposta: false, publica: false, docs: [PNG, JPG] }, id_condominio: '1' },
        autor,
      );
      expect(storage.uploadDataUrl).toHaveBeenCalledTimes(2);
      const { data } = prisma.ocorrencias.create.mock.calls[0][0];
      expect(data.anexos).toBe(`${URL_1};${URL_2}`);
      expect(data.user).toBe(100);
      expect(data.status).toBe('Pendente');
    });

    it('insert sem docs grava anexos nulo', async () => {
      const { ctrl, prisma } = montar();
      await ctrl.insert({ ocorrencia: { descricao: 'Barulho', tipo: '1', docs: [] }, id_condominio: '1' }, autor);
      expect(prisma.ocorrencias.create.mock.calls[0][0].data.anexos ?? null).toBeNull();
    });

    it('insert com descrição só de espaços: 400 "Descrição é obrigatória."', async () => {
      const { ctrl, prisma, storage } = montar();
      const e: any = await erro(ctrl.insert({ ocorrencia: { descricao: '   ', tipo: '1', docs: [PNG] }, id_condominio: '1' }, autor));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe('Descrição é obrigatória.');
      expect(prisma.ocorrencias.create).not.toHaveBeenCalled();
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    });

    it('insert em condomínio alheio: bloqueado antes de subir arquivo', async () => {
      const { ctrl, prisma, storage } = montar();
      const e = await erro(ctrl.insert({ ocorrencia: { descricao: 'X', tipo: '1', docs: [PNG] }, id_condominio: '2' }, autor));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.create).not.toHaveBeenCalled();
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    });
  });

  describe('resposta da equipe (isResposta=true)', () => {
    it('síndico responde: grava resposta e status Solucionado', async () => {
      const { ctrl, prisma } = montar();
      await ctrl.update(resposta(), sindico);
      expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.ocorrencias.update.mock.calls[0][0];
      expect(where).toEqual({ id: 5 });
      expect(data.status).toBe('Solucionado');
      expect(data.resposta).toBe('Encanador chamado');
      expect(data.resposta_at).toBeInstanceOf(Date);
    });

    it("'ciente' vira o status Ciente do service", async () => {
      const { ctrl, prisma } = montar();
      await ctrl.update(resposta({ status: 'ciente' }), sindico);
      expect(prisma.ocorrencias.update.mock.calls[0][0].data.status).toBe('Ciente');
    });

    it('sem texto: só o status muda (resposta anterior preservada)', async () => {
      const { ctrl, prisma } = montar();
      await ctrl.update(resposta({ descricao: '   ', status: 'ciente' }), sindico);
      const { data } = prisma.ocorrencias.update.mock.calls[0][0];
      expect(data).toEqual({ status: 'Ciente' });
    });

    it('status fora de ciente/solucionado: 400', async () => {
      const { ctrl, prisma } = montar();
      for (const status of ['Pendente', 'qualquer', undefined]) {
        const e = await erro(ctrl.update(resposta({ status }), sindico));
        expect(e).toBeInstanceOf(BadRequestException);
      }
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    });

    it('funcionário com a flag ocorrencias responde', async () => {
      const { ctrl, prisma } = montar({ flag: 1 });
      await ctrl.update(resposta(), funcionario);
      expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(1);
    });

    it('funcionário sem a flag: 403', async () => {
      const { ctrl, prisma } = montar({ flag: 0 });
      expect(await erro(ctrl.update(resposta(), funcionario))).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    });

    it('morador (mesmo o autor) não responde: 403', async () => {
      for (const quem of [autor, vizinho]) {
        const { ctrl, prisma } = montar();
        expect(await erro(ctrl.update(resposta(), quem))).toBeInstanceOf(ForbiddenException);
        expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
      }
    });

    it('síndico de outro condomínio: bloqueado', async () => {
      const { ctrl, prisma } = montar({ oc: { id_condominio: OUTRO_COND } });
      expect(await erro(ctrl.update(resposta(), sindico))).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('autor exclui a própria ocorrência pendente (condicionado a autor + Pendente)', async () => {
      const { ctrl, prisma } = montar();
      expect(await ctrl.remove({ id: 5 }, autor)).toEqual({ ok: true });
      expect(prisma.ocorrencias.deleteMany).toHaveBeenCalledWith({ where: { id: 5, user: 100, status: 'Pendente' } });
    });

    it('corrida: equipe deu ciência entre a leitura e o delete -> 400 e nada é apagado', async () => {
      const { ctrl, prisma } = montar({ corrida: true });
      const e: any = await erro(ctrl.remove({ id: 5 }, autor));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toContain('já está em atendimento');
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
    });

    it('autor não exclui ocorrência já atendida', async () => {
      const { ctrl, prisma } = montar({ oc: { status: 'Ciente' } });
      expect(await erro(ctrl.remove({ id: 5 }, autor))).toBeInstanceOf(BadRequestException);
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
      expect(prisma.ocorrencias.deleteMany).not.toHaveBeenCalled();
    });

    it('outro morador: 403', async () => {
      const { ctrl, prisma } = montar();
      expect(await erro(ctrl.remove({ id: 5 }, vizinho))).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
    });

    it('funcionário (mesmo com a flag) não exclui ocorrência alheia', async () => {
      const { ctrl, prisma } = montar({ flag: 1 });
      expect(await erro(ctrl.remove({ id: 5 }, funcionario))).toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
    });

    it('síndico do condomínio exclui (regra do service REST)', async () => {
      const { ctrl, prisma } = montar({ oc: { status: 'Solucionado' } });
      expect(await ctrl.remove({ id: 5 }, sindico)).toEqual({ ok: true });
      expect(prisma.ocorrencias.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    });

    it('ocorrência de outro condomínio: bloqueada para autor e síndico', async () => {
      for (const quem of [autor, sindico]) {
        const { ctrl, prisma } = montar({ oc: { id_condominio: OUTRO_COND } });
        expect(await erro(ctrl.remove({ id: 5 }, quem))).toBeInstanceOf(ForbiddenException);
        expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
      }
    });

    it('inexistente: 404; id inválido: 400', async () => {
      const { ctrl, prisma } = montar();
      prisma.ocorrencias.findUnique.mockResolvedValueOnce(null);
      expect(await erro(ctrl.remove({ id: 5 }, autor))).toBeInstanceOf(NotFoundException);
      expect(await erro(ctrl.remove({ id: 'abc' } as any, autor))).toBeInstanceOf(BadRequestException);
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
    });
  });
});
