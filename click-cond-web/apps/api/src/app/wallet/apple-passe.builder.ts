import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import * as forge from 'node-forge';
// Mesmo padrão de relatorios/condominios-export.service.ts (sem esModuleInterop).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');
import { APPLE_TEAM_ID, ChavesApple, PASS_TYPE_ID } from './wallet.constantes';

/**
 * Montagem e assinatura do passe da Apple (.pkpass), conforme
 * developer.apple.com/documentation/walletpasses ("Building a Pass", "Pass"):
 *
 *  - pass.json do tipo `generic`;
 *  - manifest.json: SHA-1 (hex) de cada arquivo do pacote, menos ele mesmo e
 *    a assinatura;
 *  - signature: PKCS#7 destacado (DER) do manifest.json, assinado com a chave
 *    do certificado do Pass Type ID, levando também o intermediário WWDR G4 e
 *    o atributo signingTime;
 *  - tudo num zip.
 *
 * Função pura: as chaves vêm de quem chama (WalletChavesService) e nunca são
 * gravadas nem logadas aqui.
 */

export type DadosDoPasse = {
  serial: string;
  authToken: string;
  webServiceUrl: string;
  condominio: string;
  morador: string;
  unidade: string;
  /** null = passe anulado (revogado ou morador removido). */
  codigo: string | null;
  /**
   * Opção do condomínio desligada: o passe segue com o código (a validação é
   * que nega, por `carteira_desligada`) e o verso avisa. Religar tira o aviso.
   */
  pausado?: boolean;
};

export const TEXTO_PASSE_PAUSADO = 'Passe pausado pelo condomínio';

export const MENSAGEM_PASSE_CANCELADO = 'PRESTARE-PASSE-CANCELADO';

const IMAGENS = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'] as const;

/** W3C/ISO 8601 com segundos e sem milissegundos, como a Apple pede. */
function dataW3c(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function montarPassJson(dados: DadosDoPasse, agora: Date = new Date()): Record<string, unknown> {
  const valido = dados.codigo !== null;
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: APPLE_TEAM_ID,
    serialNumber: dados.serial,
    authenticationToken: dados.authToken,
    webServiceURL: dados.webServiceUrl,
    organizationName: 'Prestare',
    description: 'Passe de acesso Prestare',
    logoText: 'Prestare',
    sharingProhibited: true,
    backgroundColor: 'rgb(11,11,11)',
    foregroundColor: 'rgb(255,255,255)',
    labelColor: 'rgb(163,163,163)',
    ...(valido ? {} : { voided: true, expirationDate: dataW3c(new Date(agora.getTime() - 60_000)) }),
    generic: {
      primaryFields: [{ key: 'morador', label: 'MORADOR', value: dados.morador }],
      secondaryFields: [
        { key: 'condominio', label: 'CONDOMÍNIO', value: dados.condominio },
        { key: 'unidade', label: 'UNIDADE', value: dados.unidade },
      ],
      backFields: [
        ...(valido && dados.pausado ? [{ key: 'pausado', label: 'Situação', value: TEXTO_PASSE_PAUSADO }] : []),
        {
          key: 'como_atualizar',
          label: 'Código não abre?',
          value:
            'O código deste passe muda todo dia. Se o portão não abrir, toque nos três pontos do passe e puxe a tela para baixo para atualizar. É preciso internet.',
        },
        {
          key: 'cancelar',
          label: 'Perdeu o celular?',
          value: 'Peça à portaria ou ao síndico para cancelar o passe, ou cancele pelo app Prestare em Meu acesso.',
        },
      ],
    },
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: valido ? dados.codigo : MENSAGEM_PASSE_CANCELADO,
        messageEncoding: 'iso-8859-1',
      },
    ],
  };
}

function assinarManifest(manifest: Buffer, chaves: ChavesApple, agora: Date): Buffer {
  const cert = forge.pki.certificateFromPem(chaves.certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(chaves.wwdrPem));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(chaves.chavePem) as any,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: agora as any },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

export function montarPasseApple(
  dados: DadosDoPasse,
  chaves: ChavesApple,
  imagens: Record<string, Buffer>,
  agora: Date = new Date(),
): Buffer {
  const arquivos: Record<string, Buffer> = {
    'pass.json': Buffer.from(JSON.stringify(montarPassJson(dados, agora)), 'utf8'),
  };
  for (const nome of IMAGENS) {
    if (imagens[nome]) arquivos[nome] = imagens[nome];
  }
  const manifest = Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(arquivos).map(([nome, conteudo]) => [nome, createHash('sha1').update(conteudo).digest('hex')]),
      ),
    ),
    'utf8',
  );
  const zip = new AdmZip();
  for (const [nome, conteudo] of Object.entries(arquivos)) zip.addFile(nome, conteudo);
  zip.addFile('manifest.json', manifest);
  zip.addFile('signature', assinarManifest(manifest, chaves, agora));
  return zip.toBuffer();
}

let imagensEmMemoria: Record<string, Buffer> | null = null;

function acharPasta(): string | null {
  const candidatos = [
    join(__dirname, 'assets', 'wallet'), // dist/main.js
    join(__dirname, '..', '..', 'assets', 'wallet'), // src/app/wallet (jest / ts-node)
    join(process.cwd(), 'apps', 'api', 'src', 'assets', 'wallet'),
    join(process.cwd(), 'src', 'assets', 'wallet'),
  ];
  return candidatos.find((dir) => fs.existsSync(join(dir, 'icon.png'))) ?? null;
}

/** Os cinco PNG do passe (ícone e logo, Prestare Dark), lidos uma vez. */
export function carregarImagensDoPasse(): Record<string, Buffer> {
  if (imagensEmMemoria) return imagensEmMemoria;
  const pasta = acharPasta();
  if (!pasta) throw new Error('Imagens do passe (assets/wallet) não encontradas');
  const lidas: Record<string, Buffer> = {};
  for (const nome of IMAGENS) lidas[nome] = fs.readFileSync(join(pasta, nome));
  imagensEmMemoria = lidas;
  return lidas;
}
