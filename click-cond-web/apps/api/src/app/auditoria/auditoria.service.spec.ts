import { AuditoriaService } from './auditoria.service';

/**
 * audit_logs identificava o autor só por nome e e-mail (texto livre, que muda e
 * se repete). `autor_id` + `autor_tipo` dizem quem foi e em qual tabela o id vive.
 */
describe('AuditoriaService.registrar — autor', () => {
  function build() {
    const prisma: any = { auditLog: { create: jest.fn(async () => ({})) } };
    return { svc: new AuditoriaService(prisma), prisma };
  }

  const base = { id_condominio: 7, usuario_nome: 'Zé', acao: 'LOGIN' as const, modulo: 'auth', descricao: 'x' };

  it('grava autor_id e autor_tipo quando informados', async () => {
    const { svc, prisma } = build();
    await svc.registrar({ ...base, autor_id: 3, autor_tipo: 'funcionario_portaria' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ autor_id: 3, autor_tipo: 'funcionario_portaria', acao: 'LOGIN' }),
    });
  });

  it('chamador antigo (sem os campos) grava os dois como null', async () => {
    const { svc, prisma } = build();
    await svc.registrar(base);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ autor_id: null, autor_tipo: null }),
    });
  });

  it('falha do banco não propaga', async () => {
    const { svc, prisma } = build();
    prisma.auditLog.create.mockRejectedValue(new Error('Unknown column autor_id'));
    const erro = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(svc.registrar({ ...base, autor_id: 3, autor_tipo: 'funcionario_portaria' })).resolves.toBeUndefined();
    erro.mockRestore();
  });
});
