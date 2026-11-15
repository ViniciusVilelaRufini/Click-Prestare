/**
 * Montagem e assinatura do .pkpass. Chaves e certificados gerados na hora
 * (testes/certificados-falsos.ts); nada das chaves reais.
 */
import { createHash, verify as verificarAssinatura, X509Certificate } from 'node:crypto';
import * as forge from 'node-forge';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');
import { carregarImagensDoPasse, DadosDoPasse, montarPasseApple } from './apple-passe.builder';
import { APPLE_TEAM_ID, PASS_TYPE_ID } from './wallet.constantes';
import { gerarChavesFalsas } from './testes/certificados-falsos';

const falsas = gerarChavesFalsas();
const CHAVES = { chavePem: falsas.passe.chavePem, certPem: falsas.passe.certPem, wwdrPem: falsas.wwdr.certPem };
const AGORA = new Date('2026-11-14T12:00:10.000Z');
const DADOS: DadosDoPasse = {
  serial: 'c7',
  authToken: 'Q2hhdmUtZGUtdGVzdGUtZG8tcGFzc2UtMTIz',
  webServiceUrl: 'https://api.prestarecondominios.com.br/api/wallet/apple',
  condominio: 'Residencial Teste',
  morador: 'Ana Souza',
  unidade: 'Bloco A · Apto 12',
  codigo: 'P2AAAAAAIAABISHDX2Z4VLLSGTIQ',
};
const IMAGENS = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'];

function abrir(pkpass: Buffer): Record<string, Buffer> {
  const zip = new AdmZip(pkpass);
  const saida: Record<string, Buffer> = {};
  for (const e of zip.getEntries() as any[]) saida[e.entryName] = e.getData();
  return saida;
}

/** Confere o PKCS#7 destacado: atributos assinados, digest do manifest e assinatura RSA. */
function conferirAssinatura(signature: Buffer, manifest: Buffer) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(signature.toString('binary')));
  const msg = forge.pkcs7.messageFromAsn1(asn1) as any;
  expect(msg.type).toBe(forge.pki.oids.signedData);
  // Destacado: sem conteúdo embutido.
  expect(msg.rawCapture.content).toBeUndefined();
  const certs: forge.pki.Certificate[] = msg.certificates;
  const cnS = certs.map((c) => c.subject.getField('CN')?.value);
  expect(cnS).toEqual([`Pass Type ID: ${PASS_TYPE_ID}`, 'Teste WWDR G4']);

  const signerInfo = msg.rawCapture.signerInfos[0];
  const filhos = signerInfo.value as forge.asn1.Asn1[];
  const autenticados = filhos.find((f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f.type === 0)!;
  const assinatura = filhos[filhos.length - 1];
  const atributos = autenticados.value as forge.asn1.Asn1[];
  const porOid = new Map(
    atributos.map((a) => {
      const [oid, valores] = a.value as forge.asn1.Asn1[];
      return [forge.asn1.derToOid(oid.value as string), (valores.value as forge.asn1.Asn1[])[0]];
    }),
  );
  expect(porOid.has(forge.pki.oids.signingTime)).toBe(true);
  expect(Buffer.from(porOid.get(forge.pki.oids.messageDigest)!.value as string, 'binary')).toEqual(
    createHash('sha256').update(manifest).digest(),
  );
  // A assinatura cobre os atributos autenticados codificados como SET.
  const conjunto = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, atributos);
  const der = Buffer.from(forge.asn1.toDer(conjunto).getBytes(), 'binary');
  const ok = verificarAssinatura(
    'sha256',
    der,
    new X509Certificate(CHAVES.certPem).publicKey,
    Buffer.from(assinatura.value as string, 'binary'),
  );
  expect(ok).toBe(true);
}

describe('montarPasseApple', () => {
  const imagens = carregarImagensDoPasse();

  it('carrega as cinco imagens de assets/wallet', () => {
    expect(Object.keys(imagens).sort()).toEqual([...IMAGENS].sort());
    for (const nome of IMAGENS) expect(imagens[nome].subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('o pacote contém pass.json, manifest.json, signature e as cinco imagens', () => {
    const arquivos = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA));
    expect(Object.keys(arquivos).sort()).toEqual(['manifest.json', 'pass.json', 'signature', ...IMAGENS].sort());
  });

  it('manifest.json tem o SHA-1 de cada arquivo do pacote, exceto dele mesmo e da assinatura', () => {
    const arquivos = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA));
    const manifest = JSON.parse(arquivos['manifest.json'].toString('utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['pass.json', ...IMAGENS].sort());
    for (const [nome, hash] of Object.entries(manifest)) {
      expect(hash).toBe(createHash('sha1').update(arquivos[nome]).digest('hex'));
    }
  });

  it('signature é um PKCS#7 destacado que verifica o manifest.json com o certificado de teste', () => {
    const arquivos = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA));
    conferirAssinatura(arquivos['signature'], arquivos['manifest.json']);
  });

  it('pass.json tem os campos e valores exatos da tabela, incluindo sharingProhibited true e as três cores', () => {
    const pass = JSON.parse(abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA))['pass.json'].toString('utf8'));
    expect(pass).toEqual({
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: APPLE_TEAM_ID,
      serialNumber: 'c7',
      authenticationToken: DADOS.authToken,
      webServiceURL: DADOS.webServiceUrl,
      organizationName: 'Prestare',
      description: 'Passe de acesso Prestare',
      logoText: 'Prestare',
      sharingProhibited: true,
      backgroundColor: 'rgb(11,11,11)',
      foregroundColor: 'rgb(255,255,255)',
      labelColor: 'rgb(163,163,163)',
      generic: {
        primaryFields: [{ key: 'morador', label: 'MORADOR', value: 'Ana Souza' }],
        secondaryFields: [
          { key: 'condominio', label: 'CONDOMÍNIO', value: 'Residencial Teste' },
          { key: 'unidade', label: 'UNIDADE', value: 'Bloco A · Apto 12' },
        ],
        backFields: [
          {
            key: 'como_atualizar',
            label: 'Código não abre?',
            value:
              'O código deste passe muda todo dia. Se o portão não abrir, toque nos três pontos do passe e puxe a tela para baixo para atualizar. É preciso internet.',
          },
          {
            key: 'cancelar',
            label: 'Perdeu o celular?',
            value:
              'Peça à portaria ou ao síndico para cancelar o passe, ou cancele pelo app Prestare em Meu acesso.',
          },
        ],
      },
      barcodes: [{ format: 'PKBarcodeFormatQR', message: DADOS.codigo, messageEncoding: 'iso-8859-1' }],
    });
  });

  it('o código vai em barcodes[0].message e em nenhum outro campo', () => {
    const texto = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA))['pass.json'].toString('utf8');
    expect(texto.split(DADOS.codigo!).length - 1).toBe(1);
    expect(JSON.parse(texto).barcodes[0].message).toBe(DADOS.codigo);
  });

  it('passe inválido: voided true, expirationDate no passado, message PRESTARE-PASSE-CANCELADO', () => {
    const pass = JSON.parse(
      abrir(montarPasseApple({ ...DADOS, codigo: null }, CHAVES, imagens, AGORA))['pass.json'].toString('utf8'),
    );
    expect(pass.voided).toBe(true);
    expect(pass.expirationDate).toBe('2026-11-14T11:59:10Z');
    expect(new Date(pass.expirationDate).getTime()).toBeLessThan(AGORA.getTime());
    expect(pass.barcodes).toEqual([
      { format: 'PKBarcodeFormatQR', message: 'PRESTARE-PASSE-CANCELADO', messageEncoding: 'iso-8859-1' },
    ]);
    expect(pass.serialNumber).toBe('c7');
    expect(pass.authenticationToken).toBe(DADOS.authToken);
  });

  it('passe pausado (opção do condomínio desligada): não anula nem vence, mantém o código e avisa no verso', () => {
    const pausado = { ...DADOS, pausado: true };
    const pass = JSON.parse(abrir(montarPasseApple(pausado, CHAVES, imagens, AGORA))['pass.json'].toString('utf8'));
    expect(pass.voided).toBeUndefined();
    expect(pass.expirationDate).toBeUndefined();
    expect(pass.barcodes[0].message).toBe(DADOS.codigo);
    expect(pass.generic.backFields[0]).toEqual({ key: 'pausado', label: 'Situação', value: 'Passe pausado pelo condomínio' });
    expect(pass.generic.backFields.map((f: any) => f.key)).toEqual(['pausado', 'como_atualizar', 'cancelar']);
  });

  it('pass.json não contém CPF, foto, e-mail nem telefone', () => {
    const texto = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA))['pass.json'].toString('utf8').toLowerCase();
    for (const proibido of ['cpf', 'foto', 'photo', 'email', 'e-mail', 'telefone', 'phone', 'thumbnail']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('nenhum arquivo do pacote contém a chave privada', () => {
    const arquivos = abrir(montarPasseApple(DADOS, CHAVES, imagens, AGORA));
    const corpoChave = CHAVES.chavePem.split('\n')[1];
    for (const conteudo of Object.values(arquivos)) {
      expect(conteudo.toString('binary')).not.toContain('PRIVATE KEY');
      expect(conteudo.toString('binary')).not.toContain(corpoChave);
    }
  });
});
