import { FacialService } from './facial.service';

/**
 * O chamado automático de "aparelho offline" é achado pela descrição, que cita
 * o nome (e o tipo) do aparelho. Renomear ou excluir o aparelho deixava o
 * chamado em aberto para sempre: o monitor procurava a descrição nova (e abria
 * outro chamado) e ninguém mais fechava o antigo. Agora updateDevice (nome ou
 * tipo mudou) e removeDevice fecham os chamados em aberto do nome ANTIGO,
 * só daquele condomínio.
 */
describe('FacialService — chamado de aparelho offline órfão ao renomear/excluir', () => {
  const DESC_ANTIGA = 'O dispositivo "Portaria Principal" (facial) está offline há mais de 10 minutos.';

  function build() {
    const device: any = {
      id: 9, id_condominio: 1, nome: 'Portaria Principal', tipo: 'facial', ativo: 1,
      ip: '10.0.0.9', porta: 80, api_password: null, id_area_social: null, fabricante: null,
    };
    const prisma: any = {
      facial_Devices: {
        findUnique: jest.fn(async () => ({ ...device })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data)),
        delete: jest.fn(async () => device),
      },
      acessos_Facial: { count: jest.fn(async () => 0) },
      regras_Dispositivos: { findMany: jest.fn(async () => []) },
      ocorrencias: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma };
  }

  const fechouAntigo = (prisma: any) =>
    expect(prisma.ocorrencias.updateMany).toHaveBeenCalledWith({
      where: { id_condominio: 1, descricao: DESC_ANTIGA, status: { in: ['Pendente', 'Ciente'] } },
      data: expect.objectContaining({
        status: 'Solucionado',
        resposta: expect.any(String),
        resposta_at: expect.any(Date),
      }),
    });

  it('renomear o aparelho fecha os chamados em aberto que citam o nome antigo', async () => {
    const { svc, prisma } = build();
    await svc.updateDevice(9, { nome: 'Portaria Social' });
    fechouAntigo(prisma);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data.resposta).toMatch(/renomeado/i);
  });

  it('trocar o tipo também muda a descrição: fecha o chamado antigo', async () => {
    const { svc, prisma } = build();
    await svc.updateDevice(9, { tipo: 'lpr' } as any);
    fechouAntigo(prisma);
  });

  it('editar sem mudar nome nem tipo não mexe nos chamados', async () => {
    const { svc, prisma } = build();
    await svc.updateDevice(9, { nome: 'Portaria Principal', ip: '10.0.0.9' });
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
  });

  it('excluir o aparelho fecha os chamados em aberto dele', async () => {
    const { svc, prisma } = build();
    await svc.removeDevice(9);
    fechouAntigo(prisma);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data.resposta).toMatch(/exclu/i);
  });

  it('exclusão recusada (aparelho com histórico) não fecha chamado', async () => {
    const { svc, prisma } = build();
    prisma.acessos_Facial.count.mockResolvedValue(3);
    await expect(svc.removeDevice(9)).rejects.toThrow();
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
  });

  it('falha ao fechar o chamado não desfaz a exclusão', async () => {
    const { svc, prisma } = build();
    prisma.ocorrencias.updateMany.mockRejectedValue(new Error('db'));
    await expect(svc.removeDevice(9)).resolves.toEqual({ ok: true });
  });
});
