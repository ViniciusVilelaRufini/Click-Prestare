import { fromInstanceMetadata } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';

/**
 * Credenciais do role da instância do Elastic Beanstalk (conta 850401152034).
 *
 * Não usar a cadeia padrão do SDK: ela lê AWS_ACCESS_KEY_ID antes do role, e
 * no ambiente essa variável é a chave do S3, de OUTRA conta. Bedrock e
 * Marketplace chamados com ela respondem "not available for this account".
 *
 * Fora da AWS (dev local) dá para apontar uma chave da conta certa com
 * AWS_CONTA_PRESTARE_ACCESS_KEY_ID / AWS_CONTA_PRESTARE_SECRET_ACCESS_KEY.
 */
let provedor: AwsCredentialIdentityProvider | undefined;

export function credenciaisContaPrestare(): AwsCredentialIdentityProvider {
  if (provedor) return provedor;
  const id = process.env['AWS_CONTA_PRESTARE_ACCESS_KEY_ID'];
  const segredo = process.env['AWS_CONTA_PRESTARE_SECRET_ACCESS_KEY'];
  provedor = id && segredo
    ? async () => ({ accessKeyId: id, secretAccessKey: segredo })
    : fromInstanceMetadata({ timeout: 2000, maxRetries: 2 });
  return provedor;
}
