// Configuração do serviço, toda vinda do ambiente (/etc/prestare-voz.env na EC2).
// Sem os segredos o serviço não sobe: falha fechado.

const OBRIGATORIOS = ['VOZ_INTERNAL_TOKEN', 'VOZ_TOKEN_SECRET', 'VOZ_ARI_SENHA'];

export function lerConfig(env) {
  const faltando = OBRIGATORIOS.filter((k) => !env[k] || !String(env[k]).trim());
  if (faltando.length) throw new Error(`Configuração incompleta: faltam ${faltando.join(', ')}`);
  return {
    apiBase: env.VOZ_API_BASE || 'https://api.prestarecondominios.com.br/api',
    vozToken: env.VOZ_INTERNAL_TOKEN,
    tokenSecret: env.VOZ_TOKEN_SECRET,
    ariUrl: env.VOZ_ARI_URL || 'http://127.0.0.1:8088',
    ariUser: env.VOZ_ARI_USUARIO || 'prestare',
    ariPass: env.VOZ_ARI_SENHA,
    pjsipArquivo: env.VOZ_PJSIP_ARQUIVO || '/etc/asterisk/pjsip_prestare.conf',
    controlePorta: Number(env.VOZ_CONTROLE_PORTA || 443),
    certDir: env.VOZ_CERT_DIR || '/etc/prestare-voz/tls',
  };
}
