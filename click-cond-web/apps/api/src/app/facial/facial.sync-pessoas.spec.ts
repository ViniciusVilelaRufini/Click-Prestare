import { FacialService } from './facial.service';

describe('FacialService.listSyncPessoas', () => {
  it('expÃµe o erro real persistido para a pessoa com falha de sincronizaÃ§Ã£o', async () => {
    const service = Object.create(FacialService.prototype) as FacialService;
    (service as any).prisma = {
      isConnected: true,
      moradores: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            nome: 'Fornecedor com erro',
            tipo: 'MORADOR',
            foto_pessoa: 'foto.jpg',
            face_sync_status: 'error',
            face_sync_error: 'Foto recusada pelo terminal: rosto nÃ£o detectado.',
          },
        ]),
      },
      visitantes: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(service.listSyncPessoas(7)).resolves.toEqual([
      expect.objectContaining({
        id: 10,
        status: 'error',
        motivo_detalhado: 'Foto recusada pelo terminal: rosto nÃ£o detectado.',
      }),
    ]);
  });
});
