import { redigirSegredos } from './interceptors/audit.interceptor';
import { ipEhPrivado, urlExternaSegura } from './url-segura.util';
import { StorageService } from './storage/storage.service';
import { OcorrenciasController } from '../ocorrencias/ocorrencias.controller';
import { EncomendasService } from '../encomendas/encomendas.service';
import { RegrasAcessoService } from '../regras-acesso/regras-acesso.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('AuditInterceptor.redigirSegredos', () => {
  it('descarta senhas e segredos de dispositivo em qualquer profundidade', () => {
    const r: any = redigirSegredos({
      senhaAtual: 'a',
      novaSenha: 'b',
      api_user: 'admin',
      api_password: 'c',
      nome: 'ok',
      aninhado: { password: 'x', token: 't', manter: 1 },
      lista: [{ senha: 's', id: 2 }],
    });
    expect(JSON.stringify(r)).not.toMatch(/"(senhaAtual|novaSenha|api_password|api_user|password|token|senha)"/);
    expect(r.nome).toBe('ok');
    expect(r.aninhado.manter).toBe(1);
    expect(r.lista[0].id).toBe(2);
  });
});

describe('url-segura (SSRF)', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.9', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1'])(
    'trata %s como privado',
    (ip) => expect(ipEhPrivado(ip)).toBe(true),
  );
  it('aceita IP público', () => expect(ipEhPrivado('8.8.8.8')).toBe(false));

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:3000/',
    'http://localhost/x',
    'file:///etc/passwd',
    'ftp://example.com/a.pdf',
    'http://user:pass@example.com/',
    'não é url',
  ])('bloqueia %s', async (u) => expect(await urlExternaSegura(u)).toBe(false));

  it('aceita IP público literal', async () => expect(await urlExternaSegura('https://8.8.8.8/a.pdf')).toBe(true));
});

describe('StorageService (upload público)', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  function criar() {
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.R2_BUCKET = 'bkt';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';
    const svc: any = new StorageService();
    svc.client = { send: jest.fn().mockResolvedValue({}) };
    return svc;
  }

  it('recusa Content-Type perigoso (HTML/SVG) em vez de gravar público', async () => {
    const svc = criar();
    const html = `data:text/html;base64,${Buffer.from('<script>1</script>').toString('base64')}`;
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload=1>').toString('base64')}`;
    expect(await svc.uploadDataUrl(html, 'x')).toBeNull();
    expect(await svc.uploadDataUrl(svg, 'x')).toBeNull();
    expect(svc.client.send).not.toHaveBeenCalled();
  });

  it('grava imagem permitida com o tipo e a extensão derivados do tipo validado', async () => {
    const svc = criar();
    const url = await svc.uploadDataUrl(`data:image/png;base64,${Buffer.from('x').toString('base64')}`, 'fotos', 'html');
    expect(url).toMatch(/^https:\/\/pub\.example\.com\/fotos\/.+\.png$/);
    expect(svc.client.send.mock.calls[0][0].input.ContentType).toBe('image/png');
  });

  it('deleteUrl só apaga objetos do próprio storage', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://evil.example.org/documentos/segredo.pdf')).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/../x')).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
    expect(await svc.deleteUrl('https://pub.example.com/fotos/a.png')).toBe(true);
    expect(svc.client.send.mock.calls[0][0].input.Key).toBe('fotos/a.png');
  });
});

describe('OcorrenciasController.remove', () => {
  it('propaga a rejeição do service (antes virava unhandledRejection e derrubava o processo)', async () => {
    const service: any = {
      remove: jest.fn().mockRejectedValue(new ForbiddenException('x')),
      removeCategoria: jest.fn().mockRejectedValue(new ForbiddenException('x')),
    };
    const ctrl = new OcorrenciasController(service);
    await expect(ctrl.remove(1, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.removeCategoria(1, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EncomendasService.create', () => {
  it('exige vínculo do chamador com o condomínio do body', async () => {
    const tenant: any = { assertCondominio: jest.fn().mockRejectedValue(new ForbiddenException('x')) };
    const prisma: any = { isConnected: true, encomendas: { create: jest.fn(), findFirst: jest.fn() } };
    const svc = new EncomendasService(prisma, {} as any, {} as any, {} as any, tenant);
    await expect(
      svc.create({ descricao: 'd', destinatario_apto: '1', id_condominio: 2 } as any, { sub: 1 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.encomendas.create).not.toHaveBeenCalled();
  });
});

describe('RegrasAcessoService — dispositivos de outro condomínio', () => {
  it('create rejeita dispositivo que não é do condomínio', async () => {
    const prisma: any = {
      isConnected: true,
      facial_Devices: { count: jest.fn().mockResolvedValue(0) },
      regras_Acesso: { create: jest.fn() },
    };
    const svc = new RegrasAcessoService(prisma, { registrar: jest.fn() } as any, {} as any);
    await expect(
      svc.create(1, { nome: 'r', dispositivosIds: [99] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.regras_Acesso.create).not.toHaveBeenCalled();
  });
});
