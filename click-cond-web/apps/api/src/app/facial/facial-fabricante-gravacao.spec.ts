import { ForbiddenException } from '@nestjs/common';
import {
  FABRICANTES_COM_CAMERA,
  FABRICANTES_COM_LISTAGEM,
  FacialService,
  normalizarFabricante,
} from './facial.service';
import { FacialController } from './facial.controller';
import { listarFabricantes, valoresGravadosCom } from './fabricantes';

/**
 * facial.service.ts usando o registro único de fabricantes (fabricantes.ts):
 *  - as listas de capacidade exportadas vêm do registro;
 *  - `normalizarFabricante` delega ao registro (marca desconhecida volta como veio);
 *  - createDevice/updateDevice gravam a marca na forma que os drivers esperam
 *    quando o registro a reconhece — sem trocar 'dahua' por 'intelbras', que é
 *    um valor gravado válido e distinto na tela;
 *  - GET facial/fabricantes devolve a lista para a tela montar o seletor.
 *
 * Mocks, sem banco.
 */
describe('facial.service — registro único de fabricantes', () => {
  it('as listas exportadas são as do registro', () => {
    expect(FABRICANTES_COM_LISTAGEM).toEqual(valoresGravadosCom('listagem'));
    expect(FABRICANTES_COM_CAMERA).toEqual(valoresGravadosCom('camera'));
    expect(FABRICANTES_COM_LISTAGEM).toEqual(['intelbras', 'dahua', 'hikvision', 'control_id']);
    expect(FABRICANTES_COM_CAMERA).toEqual(['intelbras', 'dahua', 'hikvision']);
  });

  describe('normalizarFabricante (o que vai para os drivers)', () => {
    it.each([
      ['dahua', 'intelbras'],
      ['intelbras', 'intelbras'],
      ['Intelbras', 'intelbras'],
      [' HIKVISION ', 'hikvision'],
      ['Control iD', 'control_id'],
      ['genérico', 'genérico'],
    ])('%j → %j', (bruto, esperado) => {
      expect(normalizarFabricante(bruto)).toBe(esperado);
    });

    it.each(['acme', 'Marca Nova', ''])('marca desconhecida %j volta como veio', (bruto) => {
      expect(normalizarFabricante(bruto)).toBe(bruto);
    });

    it('valor ausente (linha antiga sem fabricante) volta como veio, sem lançar', () => {
      expect(normalizarFabricante(null as any)).toBeNull();
      expect(normalizarFabricante(undefined as any)).toBeUndefined();
    });
  });

  describe('gravação em createDevice/updateDevice', () => {
    const COND = 10;
    const base = { id_condominio: COND, nome: 'Facial', ip: '192.168.3.176' };

    function build(existentes: any[] = []) {
      const linhas: any[] = existentes.map((d) => ({
        id_condominio: COND, ativo: 1, porta: 80, tipo: 'facial', sentido: 'auto',
        fabricante: 'intelbras', api_password: null, id_area_social: null, mac: null, ...d,
      }));
      const prisma: any = {
        facial_Devices: {
          create: jest.fn(async ({ data }: any) => ({ id: 100, ativo: 1, ...data })),
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async ({ where }: any) => {
            const d = linhas.find((x) => x.id === where.id);
            return d ? { ...d } : null;
          }),
          update: jest.fn(async ({ where, data }: any) =>
            Object.assign(linhas.find((x) => x.id === where.id), data),
          ),
        },
        areas_Sociais: { findMany: jest.fn(async () => []) },
      };
      const svc = new FacialService(
        prisma, null as any, null as any, null as any, { registrar: jest.fn(async () => undefined) } as any,
        null as any, null as any, null as any, null as any, null as any,
      );
      jest.spyOn(svc, 'syncAllForCondominio').mockResolvedValue({ total: 0, started: true } as any);
      return { svc, prisma };
    }

    const casos: Array<[string, string]> = [
      ['Intelbras', 'intelbras'],
      [' HIKVISION ', 'hikvision'],
      ['Control iD', 'control_id'],
      ['controlid', 'control_id'],
      ['hik', 'hikvision'],
      ['Generico', 'genérico'],
      ['ZKTeco', 'zkteco'],
      // 'dahua' é valor gravado válido e distinto na tela: NÃO vira 'intelbras'.
      ['dahua', 'dahua'],
      [' Dahua ', 'dahua'],
      // Marca fora do registro: aceita, gravada como veio (só sem espaços nas pontas).
      [' Marca Nova ', 'Marca Nova'],
    ];

    it.each(casos)('create: %j é gravado como %j', async (enviado, gravado) => {
      const { svc, prisma } = build();

      const criado = await svc.createDevice({ ...base, fabricante: enviado } as any);

      expect(prisma.facial_Devices.create.mock.calls[0][0].data.fabricante).toBe(gravado);
      expect(criado.fabricante).toBe(gravado);
    });

    it.each(casos)('update: %j é gravado como %j', async (enviado, gravado) => {
      const { svc, prisma } = build([{ id: 1, nome: 'Facial 1', ip: '192.168.3.175', fabricante: 'outra' }]);

      await svc.updateDevice(1, { fabricante: enviado } as any);

      expect(prisma.facial_Devices.update.mock.calls[0][0].data.fabricante).toBe(gravado);
    });

    it('update sem fabricante no corpo não toca na coluna', async () => {
      const { svc, prisma } = build([{ id: 1, nome: 'Facial 1', ip: '192.168.3.175', fabricante: 'Intelbras' }]);

      await svc.updateDevice(1, { nome: 'Outro' } as any);

      expect(prisma.facial_Devices.update.mock.calls[0][0].data).not.toHaveProperty('fabricante');
    });
  });

  describe('GET facial/fabricantes', () => {
    const ctrl = new FacialController(null as any, null as any, null as any, null as any);

    it('devolve listarFabricantes() para o operador do condomínio', () => {
      const r = ctrl.fabricantes(10, { sub: 3, id_condominio: 10 } as any);

      expect(r).toEqual(listarFabricantes());
      expect(r.map((f: any) => f.chave)).toEqual(expect.arrayContaining(['intelbras', 'hikvision', 'control_id']));
    });

    it('recusa condomínio diferente do da sessão e sessão sem condomínio', () => {
      expect(() => ctrl.fabricantes(99, { sub: 3, id_condominio: 10 } as any)).toThrow(ForbiddenException);
      expect(() => ctrl.fabricantes(10, { sub: 3 } as any)).toThrow(ForbiddenException);
    });
  });
});
