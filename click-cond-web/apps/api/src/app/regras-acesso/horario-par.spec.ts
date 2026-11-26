import { BadRequestException } from '@nestjs/common';
import { assertParHorario } from './regras-acesso.service';

describe('assertParHorario', () => {
  it('aceita os dois ou nenhum', () => {
    expect(() => assertParHorario('08:00', '18:00')).not.toThrow();
    expect(() => assertParHorario(null, null)).not.toThrow();
    expect(() => assertParHorario('', undefined)).not.toThrow();
  });
  it('recusa so um dos dois', () => {
    expect(() => assertParHorario('08:00', null)).toThrow(BadRequestException);
    expect(() => assertParHorario(undefined, '18:00')).toThrow(BadRequestException);
  });
});

import { RegrasAcessoService } from './regras-acesso.service';

describe('RegrasAcessoService.update — par de horário só quando o pedido mexe no horário', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      regras_Acesso: {
        findUnique: jest.fn(async () => ({ id: 1, id_condominio: 1, nome: 'Antiga', hora_inicio: '08:00', hora_fim: null, ativo: 1 })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, id_condominio: 1, nome: 'Antiga', ...data, dispositivos: [] })),
      },
      regras_Dispositivos: { deleteMany: jest.fn() },
    };
    const svc: any = new RegrasAcessoService(prisma, { registrar: jest.fn(async () => undefined) } as any, {} as any);
    svc.assertDispositivosDoCondominio = jest.fn(async () => undefined);
    svc.reaplicarRegras = jest.fn();
    return svc as RegrasAcessoService;
  }

  it('regra antiga com só início pode ser pausada (dto só com ativo)', async () => {
    await expect(build().update(1, { ativo: 0 } as any, 1)).resolves.toBeDefined();
  });

  it('mexer no horário de uma regra pela metade continua exigindo o par', async () => {
    await expect(build().update(1, { hora_inicio: '09:00' } as any, 1)).rejects.toThrow(BadRequestException);
  });
});
