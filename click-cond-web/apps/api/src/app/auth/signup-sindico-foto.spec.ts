import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { SindicoMobileController } from './mobile-auth.controller';

/**
 * Pentest P-09: o signup público de síndico gravava a foto no storage ANTES de
 * qualquer verificação, de qualquer tipo que o StorageService aceite (PDF,
 * planilha...) e até 25 MB. Agora:
 *  - a foto só pode ser imagem (jpeg/png/webp) de até 5 MB em base64 (o mesmo
 *    teto do convite público); fora disso, 400 sem tocar no storage;
 *  - o upload só acontece DEPOIS de a conta ser criada (e-mail/CPF únicos,
 *    senha presente): pedido recusado não deixa arquivo órfão;
 *  - o throttle da rota passa a valer por hora.
 */
function montar(opts: { emailExiste?: boolean; upload?: string | null } = {}) {
  const ordem: string[] = [];
  const prisma: any = {
    isConnected: true,
    users: {
      findFirst: jest.fn(async (args: any) => (opts.emailExiste && args?.where?.login ? { id: 1 } : null)),
      create: jest.fn(async (args: any) => {
        ordem.push('users.create');
        return { id: 77, photo: args.data.photo ?? null };
      }),
      update: jest.fn(async (args: any) => {
        ordem.push('users.update');
        return { id: 77, photo: args.data.photo };
      }),
    },
    sindicos: {
      create: jest.fn(async () => {
        ordem.push('sindicos.create');
        return { id: 5, name: 'Ana' };
      }),
    },
  };
  const storage: any = {
    isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
    uploadDataUrl: jest.fn(async () => {
      ordem.push('upload');
      return opts.upload === undefined ? 'https://bucket.example/sindicos/a.png' : opts.upload;
    }),
  };
  const jwt: any = { sign: jest.fn(() => 'tok') };
  const svc = new MobileAuthService(prisma, jwt, {} as any, storage, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma, storage, ordem };
}

const base = { nome: 'Ana', email: 'ana@x.com', password: 'Senha@123' };
const fotoPng = `data:image/png;base64,${Buffer.alloc(1000, 1).toString('base64')}`;

describe('signupSindico — foto (P-09)', () => {
  it('sobe a foto só depois de criar a conta e grava a URL no usuário', async () => {
    const { svc, prisma, ordem } = montar();
    const r = await svc.signupSindico({ ...base, photo: fotoPng });
    expect(ordem).toEqual(['users.create', 'sindicos.create', 'upload', 'users.update']);
    expect(prisma.users.create.mock.calls[0][0].data.photo).toBeNull();
    expect(prisma.users.update.mock.calls[0][0]).toMatchObject({
      where: { id: 77 },
      data: { photo: 'https://bucket.example/sindicos/a.png' },
    });
    expect(r.user.photo).toBe('https://bucket.example/sindicos/a.png');
  });

  it('e-mail já usado: recusa sem tocar no storage', async () => {
    const { svc, storage } = montar({ emailExiste: true });
    await expect(svc.signupSindico({ ...base, photo: fotoPng })).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['PDF', `data:application/pdf;base64,${Buffer.alloc(10).toString('base64')}`],
    ['SVG', `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`],
    ['HTML', `data:text/html;base64,${Buffer.from('<b>').toString('base64')}`],
  ])('foto que não é imagem (%s): 400, sem conta e sem storage', async (_n, foto) => {
    const { svc, storage, prisma } = montar();
    await expect(svc.signupSindico({ ...base, photo: foto })).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('foto acima de 5 MB em base64: 400, sem conta e sem storage', async () => {
    const { svc, storage, prisma } = montar();
    const grande = `data:image/jpeg;base64,${'A'.repeat(5 * 1024 * 1024 + 4)}`;
    await expect(svc.signupSindico({ ...base, photo: grande })).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('URL externa no lugar da foto é ignorada (não vira avatar apontando para terceiros)', async () => {
    const { svc, storage, prisma } = montar();
    await svc.signupSindico({ ...base, photo: 'https://atacante.example/x.png' });
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(prisma.users.create.mock.calls[0][0].data.photo).toBeNull();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('falha no upload não derruba o cadastro: conta criada sem foto', async () => {
    const { svc, prisma } = montar({ upload: null });
    const r = await svc.signupSindico({ ...base, photo: fotoPng });
    expect(r.token).toBe('tok');
    expect(r.user.photo).toBe('');
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('o throttle do signup conta por hora, não por minuto', () => {
    const ttl = Reflect.getMetadata('THROTTLER:TTLmedium', SindicoMobileController.prototype.signup);
    const limite = Reflect.getMetadata('THROTTLER:LIMITmedium', SindicoMobileController.prototype.signup);
    expect(ttl).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(limite).toBeLessThanOrEqual(10);
  });
});
