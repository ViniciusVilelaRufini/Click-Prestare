/**
 * Só para os specs da carteira: chaves e certificados gerados na hora, nunca
 * as chaves reais (que ficam no S3 privado). Fora de `*.spec.ts` para ser
 * compartilhado entre os specs; nenhum código de produção importa isto.
 */
import { generateKeyPairSync } from 'node:crypto';
import * as forge from 'node-forge';
import { PASS_TYPE_ID } from '../wallet.constantes';

export interface ParFalso {
  chavePem: string;
  certPem: string;
}

function certificado(
  chavePublicaPem: string,
  chaveAssinaturaPem: string,
  atributos: forge.pki.CertificateField[],
  emissor?: forge.pki.CertificateField[],
): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(chavePublicaPem);
  cert.serialNumber = '0' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  cert.setSubject(atributos);
  cert.setIssuer(emissor ?? atributos);
  cert.sign(forge.pki.privateKeyFromPem(chaveAssinaturaPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

function parRsa(): { publicKey: string; privateKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
}

/**
 * `passe`: certificado com o Pass Type ID no assunto (UID), como o da Apple,
 * emitido pelo `wwdr` falso. `outroPasse`: par válido de outro Pass Type ID.
 */
export function gerarChavesFalsas(passTypeId: string = PASS_TYPE_ID): {
  passe: ParFalso;
  wwdr: ParFalso;
} {
  const raiz = parRsa();
  const assuntoWwdr: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'Teste WWDR G4' },
    { name: 'organizationName', value: 'Teste' },
  ];
  const wwdrPem = certificado(raiz.publicKey, raiz.privateKey, assuntoWwdr);
  const passe = parRsa();
  const passePem = certificado(
    passe.publicKey,
    raiz.privateKey,
    [
      { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
      { name: 'commonName', value: `Pass Type ID: ${passTypeId}` },
      { name: 'organizationalUnitName', value: '9FD7V97G5V' },
    ],
    assuntoWwdr,
  );
  return {
    passe: { chavePem: passe.privateKey, certPem: passePem },
    wwdr: { chavePem: raiz.privateKey, certPem: wwdrPem },
  };
}
