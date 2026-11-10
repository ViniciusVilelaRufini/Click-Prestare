import { BadRequestException } from '@nestjs/common';
import { casarMorador, extrairLeitura, LeituraEtiqueta } from './ler-etiqueta';
import { EncomendasService } from './encomendas.service';

const vazia: LeituraEtiqueta = {
  nome: null, apto: null, bloco: null, transportadora: null, codigo_rastreio: null, descricao: null,
};
const leitura = (p: Partial<LeituraEtiqueta>): LeituraEtiqueta => ({ ...vazia, ...p });

describe('extrairLeitura', () => {
  it('le JSON dentro de cerca', () => {
    expect(extrairLeitura('```json\n{"nome":"Rafael Costa","apto":"106"}\n```')).toEqual(
      leitura({ nome: 'Rafael Costa', apto: '106' }),
    );
  });
  it('texto invalido vira tudo null', () => {
    expect(extrairLeitura('não sei')).toEqual(vazia);
  });
});

describe('casarMorador', () => {
  it('casa sem acento e caixa, com 2 palavras em comum', () => {
    const r = casarMorador(leitura({ nome: 'RAFAEL COSTA' }), [
      { nome: 'Rafael Costa Teste', apartamento: '106', bloco: 'A' },
    ]);
    expect(r).toEqual({ apto: '106', bloco: 'A', nome: 'Rafael Costa Teste' });
  });
  it('ambiguo sem apto -> null; com apto desambigua', () => {
    const ms = [
      { nome: 'Rafael Costa', apartamento: '106', bloco: 'A' },
      { nome: 'Rafael Costa', apartamento: '201', bloco: 'A' },
    ];
    expect(casarMorador(leitura({ nome: 'Rafael Costa' }), ms)).toBeNull();
    expect(casarMorador(leitura({ nome: 'Rafael Costa', apto: '201' }), ms)?.apto).toBe('201');
  });
  it('sem nome correspondente mas apto/bloco existentes', () => {
    const r = casarMorador(leitura({ nome: 'Fulano', apto: '106', bloco: 'A' }), [
      { nome: 'Maria Silva', apartamento: '106', bloco: 'A' },
      { nome: 'Joao', apartamento: '201', bloco: 'A' },
    ]);
    expect(r).toEqual({ apto: '106', bloco: 'A', nome: 'Maria Silva' });
  });
});

describe('EncomendasService.lerEtiqueta', () => {
  const mk = (ia: any) => {
    const prisma: any = { moradores: { findMany: jest.fn(async () => []) } };
    return new EncomendasService(prisma, {} as any, {} as any, {} as any, {} as any, ia);
  };
  const img = 'data:image/jpeg;base64,/9j/AAAA';

  it('erro da IA -> leitura vazia, sem destinatario', async () => {
    const svc = mk({ gerarComFerramentas: jest.fn(async () => { throw new Error('x'); }) });
    expect(await svc.lerEtiqueta(1, img)).toEqual({ leitura: vazia, destinatario: null });
  });
  it('imagem que nao e data URL de imagem -> 400', async () => {
    const svc = mk({ gerarComFerramentas: jest.fn() });
    await expect(svc.lerEtiqueta(1, 'data:text/plain;base64,AAAA')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('imagem acima de 5 MB -> 400', async () => {
    const svc = mk({ gerarComFerramentas: jest.fn() });
    const grande = 'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024);
    await expect(svc.lerEtiqueta(1, grande)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('fluxo feliz casa o morador', async () => {
    const ia: any = { gerarComFerramentas: jest.fn(async () => ({ texto: '{"nome":"Rafael Costa","apto":"106"}' })) };
    const prisma: any = { moradores: { findMany: jest.fn(async () => [{ nome: 'Rafael Costa', apartamento: '106', bloco: 'A' }]) } };
    const svc = new EncomendasService(prisma, {} as any, {} as any, {} as any, {} as any, ia);
    const r = await svc.lerEtiqueta(1, img);
    expect(r.destinatario).toEqual({ apto: '106', bloco: 'A', nome: 'Rafael Costa' });
    expect(ia.gerarComFerramentas.mock.calls[0][0][0].parts[1].inlineData.mimeType).toBe('image/jpeg');
  });
});
