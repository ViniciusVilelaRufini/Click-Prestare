jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../url-segura.util', () => ({ urlExternaSegura: jest.fn(async () => true) }));

import axios from 'axios';
import { FacialService } from '../../facial/facial.service';
import { ChatIaService } from '../../chat-ia/chat-ia.service';

/**
 * Com o bucket privado, o próprio servidor também só lê arquivos por link
 * assinado: a foto que o facial envia ao terminal e o PDF que a IA indexa.
 * Sem isto, o enrolamento de rostos para de funcionar no dia em que o bucket
 * fecha.
 */
describe('downloads do servidor usam link assinado', () => {
  const CANONICA = 'https://bucket.s3.amazonaws.com/moradores/a.jpg';
  const ASSINADA = `${CANONICA}?X-Amz-Signature=ok`;
  const storage = { assinarUrl: jest.fn(async () => ASSINADA) };
  const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockResolvedValue({ data: Buffer.from('img'), headers: { 'content-type': 'image/jpeg' } });
  });

  it('facial baixa a foto do terminal pelo link assinado', async () => {
    const facial: any = Object.create(FacialService.prototype);
    facial.storage = storage;
    facial.logger = logger;

    const b64 = await facial.fetchPhotoBrutaAsBase64(CANONICA);

    expect(b64).toBe(Buffer.from('img').toString('base64'));
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(ASSINADA);
  });

  it('facial converte a foto para data URL pelo link assinado', async () => {
    const facial: any = Object.create(FacialService.prototype);
    facial.storage = storage;
    facial.logger = logger;

    await facial.toDataUrl(CANONICA);

    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(ASSINADA);
  });

  it('IA baixa o PDF do documento pelo link assinado', async () => {
    const chat: any = Object.create(ChatIaService.prototype);
    chat.storage = storage;
    const fetchOriginal = global.fetch;
    const fetchMock = jest.fn(async () => ({ ok: false, status: 403, headers: new Map() }));
    (global as any).fetch = fetchMock;
    try {
      await chat.extrairTextoPdf(CANONICA).catch(() => undefined);
    } finally {
      (global as any).fetch = fetchOriginal;
    }
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(ASSINADA);
  });
});
