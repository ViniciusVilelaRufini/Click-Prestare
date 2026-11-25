/**
 * Redação e limites de tudo o que vai para audit_logs. Compartilhado pelo AuditInterceptor (log
 * genérico de escrita) e pelo AuditoriaService.registrar (log explícito dos services): o log é
 * legível por operadores do condomínio, então segredo nunca entra e documento/telefone entram só
 * mascarados. Os limites evitam que o INSERT falhe por valor maior que a coluna (o registro se
 * perderia em silêncio).
 */

/** Chaves cujo valor nunca deve ir para AuditLog.detalhes. */
const CHAVE_SENSIVEL = /(senha|password|passwd|secret|token|api_?(user|key|password)|photo|foto|assinatura|codigo_?acesso|nascimento)/i;

/** Credenciais curtas que só valem como PALAVRA inteira da chave (`pin`, `novo_pin`, `codigoOtp`), não dentro de outra (`shipping`). */
const PALAVRA_SENSIVEL = new Set(['pin', 'otp']);

/**
 * Credenciais que só valem como a chave INTEIRA (palavras juntas): `qrcode_acesso`, `qrCode`,
 * `tag_rfid`, `codigo`, `codigo_validacao`. `codigo_rastreio` (encomenda) não é credencial e fica.
 */
const CHAVE_CREDENCIAL = new Set(['qrcode', 'qrcodeacesso', 'tagrfid', 'codigo', 'codigovalidacao']);

/** Palavras de chave cujo valor é documento de identificação: mascarado, não omitido. */
const PALAVRA_DOCUMENTO = new Set(['cpf', 'rg', 'documento', 'doc']);

/** Palavras de chave cujo valor é telefone: mascarado, não omitido. */
const PALAVRA_TELEFONE = new Set(['telefone', 'celular', 'whatsapp', 'fone']);

/** `codigoAcesso` → ['codigo', 'acesso']; `doc_identificacao` → ['doc', 'identificacao']. */
function palavrasDaChave(chave: string): string[] {
  return chave
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function chaveSensivel(chave: string): boolean {
  if (CHAVE_SENSIVEL.test(chave)) return true;
  const palavras = palavrasDaChave(chave);
  if (CHAVE_CREDENCIAL.has(palavras.join(''))) return true;
  return palavras.some((p) => PALAVRA_SENSIVEL.has(p));
}

/** `tipo_documento: 'CPF'` descreve o documento, não é o documento: não mascara. */
function tipoDeMascara(chave: string): 'documento' | 'telefone' | null {
  const palavras = palavrasDaChave(chave);
  if (palavras.includes('tipo')) return null;
  if (palavras.some((p) => PALAVRA_DOCUMENTO.has(p))) return 'documento';
  if (palavras.some((p) => PALAVRA_TELEFONE.has(p))) return 'telefone';
  return null;
}

/** CPF "45346648852" → "***.***.*88-52"; outro documento → "***" + 4 últimos dígitos (2 se for curto). */
export function mascararDocumento(valor: string): string {
  const d = valor.replace(/\D/g, '');
  if (d.length === 11) return `***.***.*${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length >= 8) return `***${d.slice(-4)}`;
  if (d.length >= 4) return `***${d.slice(-2)}`;
  return '***';
}

/** Telefone com DDD → "(**) *****-0000"; sem DDD → "***0000"; curto → "***". */
export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, '');
  if (d.length >= 10) return `(**) *****-${d.slice(-4)}`;
  if (d.length >= 6) return `***${d.slice(-4)}`;
  return '***';
}

/** Limites acima dos quais o conteúdo de uma string não vai para o log, só o tamanho. */
const MAX_BASE64 = 256;
const MAX_TEXTO = 1000;

/** Conteúdo binário (data: URL, base64) ou texto longo demais vira um marcador curto com o tamanho. */
function redigirTexto(texto: string): string {
  if (/^data:[^,]*,/i.test(texto)) return `[data-url omitida: ${texto.length} caracteres]`;
  if (texto.length >= MAX_BASE64 && /^[A-Za-z0-9+/_=\r\n-]+$/.test(texto)) {
    return `[base64 omitido: ${texto.length} caracteres]`;
  }
  if (texto.length > MAX_TEXTO) return `[texto omitido: ${texto.length} caracteres]`;
  return texto;
}

type Mascara = 'documento' | 'telefone';

function aplicarMascara(mascara: Mascara, valor: string): string {
  return mascara === 'documento' ? mascararDocumento(valor) : mascararTelefone(valor);
}

/**
 * Copia o valor descartando, recursivamente, qualquer chave sensível e mascarando documento e
 * telefone (só strings; número/booleano/null passam inalterados). Sob uma chave de documento ou
 * telefone, o "modo máscara" desce para objetos e arrays: o diff `documento: { de, para }` sai com
 * as duas folhas mascaradas, não inteiro.
 */
export function redigirSegredos(valor: unknown, profundidade = 0, mascara: Mascara | null = null): unknown {
  if (typeof valor === 'string') return mascara ? aplicarMascara(mascara, valor) : redigirTexto(valor);
  if (valor === null || typeof valor !== 'object' || profundidade > 6) return valor;
  if (Array.isArray(valor)) return valor.map((v) => redigirSegredos(v, profundidade + 1, mascara));
  if (valor instanceof Date) return valor;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (chaveSensivel(k)) continue;
    out[k] = redigirSegredos(v, profundidade + 1, tipoDeMascara(k) ?? mascara);
  }
  return out;
}

/** Limite de AuditLog.detalhes. */
const MAX_DETALHES = 2000;

/**
 * Serializa os detalhes sempre como JSON válido dentro do limite (a tela faz JSON.parse). Quando
 * não cabe, grava um resumo com marcador de truncamento e as chaves de primeiro nível que couberem.
 */
export function serializarDetalhes(valor: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(valor ?? {}) ?? '{}';
  } catch {
    // Referência circular ou BigInt: o registro não se perde por causa dos detalhes.
    return JSON.stringify({ _erro: 'detalhes não serializáveis' });
  }
  if (json.length <= MAX_DETALHES) return json;
  const chaves = valor && typeof valor === 'object' && !Array.isArray(valor) ? Object.keys(valor) : [];
  for (let n = chaves.length; ; n--) {
    const resumo = JSON.stringify({
      _truncado: true,
      tamanho: json.length,
      chaves: chaves.slice(0, n),
      chaves_omitidas: chaves.length - n,
    });
    if (resumo.length <= MAX_DETALHES || n === 0) return resumo;
  }
}

/** Tamanho máximo de cada coluna de texto de audit_logs (ver prisma/schema.prisma, model AuditLog). */
export const LIMITES_AUDITORIA = {
  usuario_nome: 255,
  usuario_email: 255,
  acao: 50,
  modulo: 100,
  descricao: 2000,
  ip: 45,
} as const;

/** Corta o texto no limite da coluna; null/undefined continuam null. */
export function cortar(valor: string | null | undefined, max: number): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor);
  return s.length > max ? s.substring(0, max) : s;
}

/**
 * Nome e e-mail de quem está logado, na mesma regra do AuditInterceptor: o token do app aninha o
 * usuário em `user`, o do console traz os campos na raiz.
 */
export function identidadeDoToken(user: any): { nome?: string; email?: string } {
  const p = user?.user ?? user ?? {};
  const nome = p?.nome ?? p?.name;
  const email = p?.email;
  return {
    nome: typeof nome === 'string' && nome.trim() ? nome : undefined,
    email: typeof email === 'string' && email.trim() ? email : undefined,
  };
}

/** Rótulos que os chamadores usam quando não sabem quem fez a ação. */
const ROTULOS_GENERICOS = new Set(['sistema', 'sistema / portaria', 'portaria / sistema', 'portaria', 'morador']);

export function nomeGenerico(nome: string | null | undefined): boolean {
  return !nome || ROTULOS_GENERICOS.has(String(nome).trim().toLowerCase());
}
