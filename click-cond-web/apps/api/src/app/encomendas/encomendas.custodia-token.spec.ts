import { ConflictException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';

/**
 * `retirar`/`receber` gravavam `operador.sub` em colunas que são FK para Users. No token do porteiro do
 * console o `sub` é Funcionarios_Portaria.id: a custódia ia para o Users de mesmo número.
 */
describe('Encomendas — quem entregou/recebeu vem de idUsuarioDoToken', () => {
  const porteiro = { sub: 7, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria' } as any;
  const sindico = { sub: 3, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico', user: { id: 3 } } as any;

  function build() {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ id_condominio: 1, retirado_assinatura: null, retirado_foto: null })),
        findMany: jest.fn(async () => []),
        // count 0 → ConflictException logo depois do updateMany: basta para ler o `data` gravado.
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new EncomendasService(prisma, {} as any, storage, { registrar: jest.fn() } as any, tenant);
    return { svc, prisma };
  }

  it('retirar pelo porteiro grava entregue_por_user = null', async () => {
    const { svc, prisma } = build();
    await expect(svc.retirar(44, 'Morador QA', undefined, undefined, undefined, porteiro)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.encomendas.updateMany.mock.calls[0][0].data.entregue_por_user).toBeNull();
  });

  it('receber pelo porteiro grava recebido_por_user = null', async () => {
    const { svc, prisma } = build();
    await expect(svc.receber(91, porteiro)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.encomendas.updateMany.mock.calls[0][0].data.recebido_por_user).toBeNull();
  });

  it('síndico continua gravando o próprio Users.id', async () => {
    const { svc, prisma } = build();
    await expect(svc.receber(91, sindico)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.encomendas.updateMany.mock.calls[0][0].data.recebido_por_user).toBe(3);
  });
});
