/**
 * Rótulos em português e redação de dados pessoais para o que sai do log de
 * auditoria e do Log de Eventos (CSV e feed da portaria).
 *
 * Os mapas são exportados para quem mais precisar mostrar ação/módulo do
 * `audit_logs` sem repetir a tabela.
 */

import { redigirSegredos } from '../common/auditoria-redacao.util';

/** `audit_logs.acao` → rótulo exibido. Ação fora do mapa sai como veio. */
export const ROTULOS_ACAO_AUDITORIA: Readonly<Record<string, string>> = {
  CREATE: 'Criação',
  UPDATE: 'Atualização',
  DELETE: 'Remoção',
  CHECK_IN: 'Entrada',
  CHECK_OUT: 'Saída',
  ENTREGA: 'Entrega',
  RETIRADA: 'Retirada',
  RESPOSTA: 'Resposta',
  STATUS: 'Mudança de status',
  EXECUTE: 'Execução',
  EXPORT: 'Exportação',
  LOGIN: 'Login',
  LOGIN_FALHA: 'Falha de login',
  ACCESS_GRANTED: 'Acesso liberado',
  ACCESS_DENIED: 'Acesso negado',
  MANUAL_OVERRIDE: 'Abertura manual',
  BRIDGE_TRIGGER: 'Abertura automática',
  RULE_CHANGE: 'Alteração de regra de acesso',
  DEVICE_CHANGE: 'Alteração de dispositivo',
  ONLINE: 'Dispositivo online',
  OFFLINE: 'Dispositivo offline',
  FANTASMAS_REMOVIDOS: 'Biometrias órfãs removidas',
  DISPOSITIVO_IP_CORRIGIDO: 'IP do dispositivo corrigido',
  DISPOSITIVO_MAC_ATUALIZADO: 'Aparelho trocado (MAC novo)',
  DEACTIVATE: 'Condomínio desativado',
  REACTIVATE: 'Condomínio reativado',
};

/** `audit_logs.modulo` → rótulo exibido. Módulo fora do mapa sai como veio. */
export const ROTULOS_MODULO_AUDITORIA: Readonly<Record<string, string>> = {
  visitantes: 'Visitantes',
  visitas: 'Visitantes',
  pessoas: 'Visitantes',
  encomendas: 'Encomendas',
  moradores: 'Moradores',
  apartamentos: 'Apartamentos',
  vagas: 'Vagas',
  veiculos: 'Veículos',
  tags: 'Tags de veículo',
  ocorrencias: 'Ocorrências',
  comunicados: 'Comunicados',
  prestadores: 'Prestadores',
  delivery: 'Delivery',
  entrega: 'Delivery',
  convites: 'Convites',
  financeiro: 'Financeiro',
  superlogica: 'Superlógica',
  assembleias: 'Assembleias',
  documentos: 'Documentos',
  mudancas: 'Mudanças',
  'areas-sociais': 'Áreas sociais',
  facial: 'Reconhecimento facial',
  'facial-health': 'Reconhecimento facial',
  dispositivos: 'Dispositivos',
  'regras-acesso': 'Regras de acesso',
  'caminhos-acesso': 'Caminhos de acesso',
  consentimentos: 'Consentimentos',
  credenciais: 'Credenciais',
  wallet: 'Credenciais',
  'portaria-remota': 'Portaria remota',
  guarita: 'Guarita',
  'portaria-equipe': 'Equipe da portaria',
  funcionarios: 'Funcionários',
  sindico: 'Síndico',
  users: 'Conta do usuário',
  condominios: 'Condomínio',
  agenda: 'Agenda',
  contatos: 'Contatos',
  notificacoes: 'Notificações',
  'chat-ia': 'Assistente IA',
  auth: 'Autenticação',
  dashboard: 'Painel',
  relatorios: 'Relatórios',
  auditoria: 'Auditoria',
  crm: 'CRM',
  'crm-condominio': 'CRM',
  'crm-morador': 'CRM',
  sistema: 'Sistema',
};

export function rotuloAcaoAuditoria(acao: string | null | undefined): string {
  if (!acao) return '';
  return ROTULOS_ACAO_AUDITORIA[acao.toUpperCase()] ?? acao;
}

export function rotuloModuloAuditoria(modulo: string | null | undefined): string {
  if (!modulo) return '';
  return ROTULOS_MODULO_AUDITORIA[modulo.toLowerCase()] ?? modulo;
}

/**
 * Troca por `*` todo caractere alfanumérico, menos os 4 últimos dígitos;
 * a pontuação fica. Com 4 dígitos ou menos, nada fica à vista.
 */
function manterUltimos4Digitos(s: string): string {
  const totalDigitos = (s.match(/\d/g) ?? []).length;
  let visiveis = totalDigitos > 4 ? 4 : 0;
  const saida: string[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (/\d/.test(c) && visiveis > 0) {
      saida.push(c);
      visiveis--;
    } else if (/[\p{L}\p{N}]/u.test(c)) {
      saida.push('*');
    } else {
      saida.push(c);
    }
  }
  return saida.reverse().join('');
}

/**
 * Documento (CPF, RG…) só com os 4 últimos dígitos: "45346648852" →
 * "***.***.*88-52". Sem dígito nenhum (ex.: "Não informado") passa como veio.
 */
export function mascararDocumento(doc: string | number | null | undefined): string | undefined {
  if (doc === null || doc === undefined) return undefined;
  const s = String(doc);
  if (!/\d/.test(s)) return s;
  // CPF sem pontuação: mostra no formato de CPF, para ficar claro o que é.
  if (/^\d{11}$/.test(s)) return `***.***.*${s.slice(7, 9)}-${s.slice(9)}`;
  return manterUltimos4Digitos(s);
}

/** Telefone só com os 4 últimos dígitos: "(17) 99660-8148" → "(**) *****-8148". */
export function mascararTelefone(tel: string | number | null | undefined): string | undefined {
  if (tel === null || tel === undefined) return undefined;
  const s = String(tel);
  if (!/\d/.test(s)) return s;
  return manterUltimos4Digitos(s);
}

/**
 * Coluna "Detalhes" do CSV da auditoria. Linhas antigas gravaram o PIN da
 * visita (`codigoAcesso`), senha temporária, token e o CPF inteiro nos
 * detalhes; a tela já os escondia, o CSV não. Passa pela MESMA redação da
 * gravação (`redigirSegredos` de common/auditoria-redacao.util), então o que
 * a regra nova esconde também some das linhas antigas.
 * Texto que não é JSON: apaga o valor depois de uma chave de segredo e
 * mascara sequências longas de dígitos (CPF/telefone soltos).
 */
export function redigirDetalhesAuditoriaCsv(detalhes: string | null | undefined): string {
  if (!detalhes) return '';
  try {
    const obj = JSON.parse(detalhes);
    if (obj && typeof obj === 'object') return JSON.stringify(redigirSegredos(obj));
  } catch {
    // não é JSON: cai na redação por texto
  }
  return detalhes
    .replace(
      /\b(\w*(?:senha|password|token|secret)\w*|codigo_?acesso|codigo_?validacao|codigo|qr_?code\w*|tag_?rfid|\w*_pin|pin|otp)(\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
      '$1$2[removido]',
    )
    .replace(/\d[\d.\-/ ]{6,}\d/g, (m) => manterUltimos4Digitos(m));
}
