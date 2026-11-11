import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import { ChatIaService } from './chat-ia.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

const MSG_ARQUIVO = 'Arquivo não aceito: envie PDF ou imagem de até 5 MB.';
const MSG_COTA = 'Limite diário do assistente atingido. Tente novamente amanhã.';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const arq = (buf: Buffer, mime = 'image/png') => ({ nome: 'x', mime_type: mime, base64: buf.toString('base64') });

function criar(opts: { gerar?: jest.Mock } = {}) {
  const gerar =
    opts.gerar ?? jest.fn(async () => ({ texto: 'ok', chamadas: [], partesModelo: [] }));
  const prisma: any = { apartamentos_Users: { findMany: jest.fn(async () => []) } };
  const ia: any = { isConfigured: false, gerarComFerramentas: gerar };
  const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
  const svc = new ChatIaService(
    prisma, tenant, ia,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { svc, gerar, prisma };
}
const user = (id = 1): any => ({ sub: id, typeAccess: 'Sindico', user: { id } });

describe('ChatIaService - validação do anexo', () => {
  it('aceita PDF, JPEG, PNG e WEBP e envia o tipo detectado pelos bytes', async () => {
    const casos: [Buffer, string][] = [
      [PDF, 'application/pdf'], [JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp'],
    ];
    for (const [buf, mime] of casos) {
      const { svc, gerar } = criar();
      await svc.responder(1, 'oi', user(), undefined, arq(buf, 'image/gif'));
      const ultimo = gerar.mock.calls[0][0].at(-1);
      expect(ultimo.parts[0].inlineData.mimeType).toBe(mime);
    }
  });

  it('HTML/EXE renomeado como imagem -> 400 e não chama o modelo', async () => {
    for (const buf of [Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000')]) {
      const { svc, gerar } = criar();
      const p = svc.responder(1, 'oi', user(), undefined, arq(buf, 'image/png'));
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toMatchObject({ message: MSG_ARQUIVO });
      expect(gerar).not.toHaveBeenCalled();
    }
  });

  it('acima de 5 MB decodificado -> 400', async () => {
    const { svc, gerar } = criar();
    const grande = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    await expect(svc.responder(1, 'oi', user(), undefined, arq(grande))).rejects.toMatchObject({
      message: MSG_ARQUIVO,
    });
    expect(gerar).not.toHaveBeenCalled();
  });
});

describe('ChatIaService - anexo em no máximo 2 rodadas', () => {
  /** Modelo que pede `ferramenta` nas `n` primeiras rodadas e depois encerra. */
  function modelo(rodadasComFerramenta: number, ferramenta = 'inexistente') {
    const snapshots: string[] = [];
    let n = 0;
    const gerar = jest.fn(async (contents: any[]) => {
      snapshots.push(JSON.stringify(contents));
      n++;
      if (n <= rodadasComFerramenta) {
        return {
          texto: '',
          chamadas: [{ name: ferramenta, args: {} }],
          partesModelo: [{ functionCall: { name: ferramenta, args: {} } }],
        };
      }
      return { texto: 'fim', chamadas: [], partesModelo: [] };
    });
    return { gerar, snapshots };
  }

  it('leitura na 1ª rodada: a 2ª ainda vê o anexo (extrai os valores da fatura); da 3ª em diante, texto curto', async () => {
    const { gerar, snapshots } = modelo(3);
    const { svc } = criar({ gerar: gerar as any });
    await svc.responder(1, 'oi', user(), undefined, arq(PNG));
    expect(gerar).toHaveBeenCalledTimes(4);
    expect(snapshots[0]).toContain('inlineData');
    expect(snapshots[1]).toContain('inlineData');
    expect(snapshots[2]).not.toContain('inlineData');
    expect(snapshots[3]).not.toContain('inlineData');
    expect(snapshots[2]).toContain('[anexo enviado na primeira mensagem]');
  });

  it('o modelo propôs a ação: as rodadas seguintes já não carregam o anexo', async () => {
    const { gerar, snapshots } = modelo(1, 'propor_algo');
    const { svc } = criar({ gerar: gerar as any });
    jest
      .spyOn(svc as any, 'executarFerramenta')
      .mockImplementation(async (_c: any, _ctx: any, propostas: any) => {
        propostas.push({ id: 'p1', tipo: 'teste', itens: [] });
        return { status: 'aguardando_confirmacao' };
      });
    await svc.responder(1, 'oi', user(), undefined, arq(PNG));
    expect(gerar).toHaveBeenCalledTimes(2);
    expect(snapshots[0]).toContain('inlineData');
    expect(snapshots[1]).not.toContain('inlineData');
  });

  it('a pergunta com anexo e várias rodadas continua contando 1 na cota', async () => {
    const env = { ...process.env };
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '1';
    try {
      const { gerar } = modelo(2);
      const { svc } = criar({ gerar: gerar as any });
      await expect(svc.responder(1, 'oi', user(), undefined, arq(PNG))).resolves.toBeDefined();
      expect(gerar).toHaveBeenCalledTimes(3);
      await expect(svc.responder(1, 'de novo', user())).rejects.toMatchObject({ status: 429 });
    } finally {
      process.env = { ...env };
    }
  });
});

describe('ChatIaService - cota diária', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('cota por usuário: estourou -> 429, sem chamar o modelo', async () => {
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '2';
    const { svc, gerar } = criar();
    await svc.responder(1, 'a', user(7));
    await svc.responder(1, 'b', user(7));
    const p = svc.responder(1, 'c', user(7));
    await expect(p).rejects.toBeInstanceOf(HttpException);
    await expect(p).rejects.toMatchObject({ status: 429, message: MSG_COTA });
    expect(gerar).toHaveBeenCalledTimes(2);
    await svc.responder(1, 'd', user(8));
    expect(gerar).toHaveBeenCalledTimes(3);
  });

  it('cota por condomínio soma todos os usuários', async () => {
    process.env['CHAT_IA_COTA_CONDOMINIO_DIA'] = '2';
    const { svc, gerar } = criar();
    await svc.responder(1, 'a', user(1));
    await svc.responder(1, 'b', user(2));
    await expect(svc.responder(1, 'c', user(3))).rejects.toMatchObject({ status: 429, message: MSG_COTA });
    expect(gerar).toHaveBeenCalledTimes(2);
  });

  it('pergunta com várias rodadas de ferramenta conta 1', async () => {
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '1';
    let n = 0;
    const gerar = jest.fn(async () => {
      n++;
      if (n === 1) {
        return {
          texto: '',
          chamadas: [{ name: 'x', args: {} }],
          partesModelo: [{ functionCall: { name: 'x', args: {} } }],
        };
      }
      return { texto: 'ok', chamadas: [], partesModelo: [] };
    });
    const { svc } = criar({ gerar: gerar as any });
    await expect(svc.responder(1, 'a', user())).resolves.toBeDefined();
    expect(gerar).toHaveBeenCalledTimes(2);
  });

  it('erro antes do modelo não consome cota', async () => {
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '1';
    const { svc, gerar, prisma } = criar();
    prisma.apartamentos_Users.findMany.mockRejectedValueOnce(new Error('banco caiu'));
    await expect(svc.responder(1, 'a', user())).rejects.toThrow();
    expect(gerar).not.toHaveBeenCalled();
    await expect(svc.responder(1, 'a', user())).resolves.toBeDefined();
    expect(gerar).toHaveBeenCalledTimes(1);
  });

  it('anexo recusado não consome cota', async () => {
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '1';
    const { svc } = criar();
    await expect(
      svc.responder(1, 'a', user(), undefined, arq(Buffer.from('<html>'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.responder(1, 'a', user())).resolves.toBeDefined();
  });
});

describe('ChatIaService - cota antes do trabalho pago', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('cota estourada não gera embedding pago nem consulta o banco de contexto', async () => {
    process.env['CHAT_IA_COTA_USUARIO_DIA'] = '1';
    const { svc, gerar, prisma } = criar();
    const embedText = jest.fn(async () => [1, 0]);
    (svc as any).ia.isConfigured = true;
    (svc as any).ia.embedText = embedText;
    prisma.rag_Embeddings = { findMany: jest.fn(async () => [{ chunk_text: 't', embedding: [1, 0] }]) };
    await svc.responder(1, 'a', user());
    embedText.mockClear();
    prisma.rag_Embeddings.findMany.mockClear();
    await expect(svc.responder(1, 'b', user())).rejects.toMatchObject({ status: 429 });
    expect(embedText).not.toHaveBeenCalled();
    expect(prisma.rag_Embeddings.findMany).not.toHaveBeenCalled();
    expect(gerar).toHaveBeenCalledTimes(1);
  });
});

