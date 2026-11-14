/**
 * Chaves da Apple lidas do S3 privado: memória depois do primeiro sucesso,
 * nova tentativa só passados 5 minutos quando faltam, e nada de conteúdo de
 * chave em log.
 */
import { Logger } from '@nestjs/common';
import { CHAVES_S3 } from './wallet.constantes';
import { WalletChavesService } from './wallet-chaves.service';
import { gerarChavesFalsas } from './testes/certificados-falsos';

const falsas = gerarChavesFalsas();
const outroPasse = gerarChavesFalsas('pass.com.outro.emissor');

function build(objetos: Record<string, string | null | Error>) {
  const storage = {
    lerObjetoTexto: jest.fn(async (key: string) => {
      const v = objetos[key];
      if (v instanceof Error) throw v;
      return v ?? null;
    }),
  };
  return { svc: new WalletChavesService(storage as any), storage };
}

const COMPLETO = () => ({
  [CHAVES_S3.applePassKey]: falsas.passe.chavePem,
  [CHAVES_S3.applePassCert]: falsas.passe.certPem,
  [CHAVES_S3.appleWwdr]: falsas.wwdr.certPem,
});

describe('WalletChavesService', () => {
  let agora = Date.parse('2026-11-14T12:00:00Z');
  let espioLog: jest.SpyInstance[];
  beforeEach(() => {
    agora = Date.parse('2026-11-14T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
    espioLog = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('devolve as três peças quando estão no S3', async () => {
    const { svc } = build(COMPLETO());
    expect(await svc.apple()).toEqual({
      chavePem: falsas.passe.chavePem,
      certPem: falsas.passe.certPem,
      wwdrPem: falsas.wwdr.certPem,
    });
  });

  it.each([CHAVES_S3.applePassKey, CHAVES_S3.applePassCert, CHAVES_S3.appleWwdr])(
    'devolve null quando falta %s, sem lançar',
    async (falta) => {
      const objetos = COMPLETO() as Record<string, string | null>;
      objetos[falta] = null;
      const { svc } = build(objetos);
      await expect(svc.apple()).resolves.toBeNull();
    },
  );

  it('erro do S3 conta como ausente, sem lançar', async () => {
    const objetos: Record<string, any> = COMPLETO();
    objetos[CHAVES_S3.applePassKey] = new Error('AccessDenied');
    const { svc } = build(objetos);
    await expect(svc.apple()).resolves.toBeNull();
  });

  it('PEM ilegível, chave que não é do certificado ou certificado de outro Pass Type ID contam como ausentes', async () => {
    const lixo = build({ ...COMPLETO(), [CHAVES_S3.applePassCert]: '-----BEGIN CERTIFICATE-----\nxx\n-----END CERTIFICATE-----' });
    expect(await lixo.svc.apple()).toBeNull();

    const trocada = build({ ...COMPLETO(), [CHAVES_S3.applePassKey]: falsas.wwdr.chavePem });
    expect(await trocada.svc.apple()).toBeNull();

    const outro = build({
      ...COMPLETO(),
      [CHAVES_S3.applePassKey]: outroPasse.passe.chavePem,
      [CHAVES_S3.applePassCert]: outroPasse.passe.certPem,
    });
    expect(await outro.svc.apple()).toBeNull();
  });

  it('depois de null, só volta a consultar o S3 passados 5 minutos (Review Focus 4)', async () => {
    const objetos: Record<string, string | null> = { ...COMPLETO(), [CHAVES_S3.appleWwdr]: null };
    const { svc, storage } = build(objetos);
    expect(await svc.apple()).toBeNull();
    const chamadas = storage.lerObjetoTexto.mock.calls.length;

    // Os arquivos aparecem no S3 com a API no ar.
    objetos[CHAVES_S3.appleWwdr] = falsas.wwdr.certPem;
    agora += 4 * 60 * 1000;
    expect(await svc.apple()).toBeNull();
    expect(storage.lerObjetoTexto.mock.calls.length).toBe(chamadas);

    agora += 61 * 1000;
    expect(await svc.apple()).not.toBeNull();
  });

  it('guarda em memória depois do primeiro sucesso', async () => {
    const { svc, storage } = build(COMPLETO());
    await svc.apple();
    const chamadas = storage.lerObjetoTexto.mock.calls.length;
    agora += 30 * 60 * 1000;
    await svc.apple();
    await svc.apple();
    expect(storage.lerObjetoTexto.mock.calls.length).toBe(chamadas);
  });

  it('chamadas simultâneas na primeira carga leem o S3 uma vez só', async () => {
    const { svc, storage } = build(COMPLETO());
    await Promise.all([svc.apple(), svc.apple(), svc.apple()]);
    expect(storage.lerObjetoTexto).toHaveBeenCalledTimes(3);
  });

  it('chave trocada no S3 é relida em até 1 hora; falha na releitura mantém a anterior', async () => {
    const objetos: Record<string, string | null> = COMPLETO();
    const { svc } = build(objetos);
    expect((await svc.apple())!.certPem).toBe(falsas.passe.certPem);

    const nova = gerarChavesFalsas();
    objetos[CHAVES_S3.applePassKey] = nova.passe.chavePem;
    objetos[CHAVES_S3.applePassCert] = nova.passe.certPem;
    agora += 61 * 60 * 1000;
    expect((await svc.apple())!.certPem).toBe(nova.passe.certPem);

    objetos[CHAVES_S3.applePassKey] = null;
    agora += 61 * 60 * 1000;
    expect((await svc.apple())!.certPem).toBe(nova.passe.certPem);
  });

  it('nenhuma chamada de logger recebe o conteúdo de uma chave', async () => {
    for (const objetos of [
      COMPLETO(),
      { ...COMPLETO(), [CHAVES_S3.appleWwdr]: null },
      { ...COMPLETO(), [CHAVES_S3.applePassKey]: falsas.wwdr.chavePem },
    ]) {
      await build(objetos).svc.apple();
    }
    const tudo = espioLog.flatMap((e) => e.mock.calls.flat()).map(String).join('\n');
    expect(tudo).not.toContain('PRIVATE KEY');
    expect(tudo).not.toContain('BEGIN CERTIFICATE');
    expect(tudo).not.toContain(falsas.passe.chavePem.split('\n')[1]);
  });
});
