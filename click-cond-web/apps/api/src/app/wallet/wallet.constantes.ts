/** Identificadores fixos do passe da Apple (não são segredo). */
export const PASS_TYPE_ID = 'pass.br.com.prestarecondominios.acesso';
export const APPLE_TEAM_ID = '9FD7V97G5V';

/**
 * Base do serviço de atualização (`webServiceURL` do pass.json). A Apple
 * acrescenta `/v1/...`; o controller fica em `/api/wallet/apple`.
 */
export const WALLET_WEB_SERVICE_URL = 'https://api.prestarecondominios.com.br/api/wallet/apple';

/**
 * Chaves de objeto no S3 privado: as únicas que a API lê para a carteira.
 * Nada disto vai em variável de ambiente (Elastic Beanstalk no limite de
 * 4096 caracteres) nem no repositório.
 */
export const CHAVES_S3 = {
  applePassKey: 'config/wallet/apple/pass.key',
  applePassCert: 'config/wallet/apple/pass.pem',
  appleWwdr: 'config/wallet/apple/wwdr-g4.pem',
} as const;

export type ChavesApple = { chavePem: string; certPem: string; wwdrPem: string };

export type Carteira = 'apple' | 'google';
