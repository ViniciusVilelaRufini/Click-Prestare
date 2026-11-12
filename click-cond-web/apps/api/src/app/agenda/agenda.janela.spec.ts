import { BadRequestException } from '@nestjs/common';
import { AgendaService } from './agenda.service';

describe('AgendaService — término não pode ser anterior ao início', () => {
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const MSG = 'O término da manutenção precisa ser depois do início.';

  function build(atual: any = {}) {
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const prisma: any = {
      agenda: {
        findUnique: jest.fn(async () => ({
          id_condominio: 2,
          data_inicio: new Date(Date.UTC(2026, 10, 10)),
          data_termino: new Date(Date.UTC(2026, 10, 12)),
          hora_inicio: new Date(Date.UTC(1970, 0, 1, 9, 0)),
          hora_termino: new Date(Date.UTC(1970, 0, 1, 18, 0)),
          ...atual,
        })),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
    };
    return { svc: new AgendaService(prisma, tenant), prisma };
  }

  it('create: data de término antes do início -> 400 e nada gravado', async () => {
    const { svc, prisma } = build();
    const p = svc.create(2, { titulo: 'Bomba', data_inicio: '12/11/2026', data_termino: '10/11/2026' }, sindico);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(MSG);
    expect(prisma.agenda.create).not.toHaveBeenCalled();
  });

  it('create: mesmo dia com hora de término antes da de início -> 400', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.create(2, { titulo: 'Bomba', data_inicio: '12/11/2026', data_termino: '12/11/2026', hora_inicio: '15:00', hora_termino: '09:00' }, sindico),
    ).rejects.toThrow(MSG);
    expect(prisma.agenda.create).not.toHaveBeenCalled();
  });

  it('create: janela válida (ou sem hora) grava', async () => {
    const { svc, prisma } = build();
    await svc.create(2, { titulo: 'A', data_inicio: '12/11/2026', data_termino: '12/11/2026', hora_inicio: '09:00', hora_termino: '10:00' }, sindico);
    await svc.create(2, { titulo: 'B', data_inicio: '12/11/2026', data_termino: '13/11/2026' }, sindico);
    expect(prisma.agenda.create).toHaveBeenCalledTimes(2);
  });

  it('update: só data_inicio vem e passa do término atual -> 400', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(2, { id: 1, data_inicio: '20/11/2026' }, sindico)).rejects.toThrow(MSG);
    expect(prisma.agenda.update).not.toHaveBeenCalled();
  });

  it('update: só hora_termino vem e fica antes da hora_inicio atual no mesmo dia -> 400', async () => {
    const { svc, prisma } = build({ data_termino: new Date(Date.UTC(2026, 10, 10)) });
    await expect(svc.update(2, { id: 1, hora_termino: '08:00' }, sindico)).rejects.toThrow(MSG);
    expect(prisma.agenda.update).not.toHaveBeenCalled();
  });

  it('update: alteração coerente com o atual grava', async () => {
    const { svc, prisma } = build();
    await svc.update(2, { id: 1, data_termino: '15/11/2026' }, sindico);
    expect(prisma.agenda.update).toHaveBeenCalledTimes(1);
  });
});
