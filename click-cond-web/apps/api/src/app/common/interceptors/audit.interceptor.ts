import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';
import { extractClientIp } from '../context/request-context';
import { TenantAccessService } from '../../auth/tenant-access.service';
import { autorDoToken, idUsuarioDoToken } from '../../auth/usuario-do-token.util';

/** Chaves cujo valor nunca deve ir para AuditLog.detalhes (legível por operadores do condomínio). */
const CHAVE_SENSIVEL = /(senha|password|passwd|secret|token|api_?(user|key|password)|photo|foto|assinatura|codigo_?acesso)/i;

/** Credenciais curtas que só valem como PALAVRA inteira da chave (`pin`, `novo_pin`, `codigoOtp`), não dentro de outra (`shipping`). */
const PALAVRA_SENSIVEL = new Set(['pin', 'otp']);

function chaveSensivel(chave: string): boolean {
  if (CHAVE_SENSIVEL.test(chave)) return true;
  const palavras = chave.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/);
  return palavras.some((p) => PALAVRA_SENSIVEL.has(p));
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

/** Copia o valor descartando, recursivamente, qualquer chave sensível. */
export function redigirSegredos(valor: unknown, profundidade = 0): unknown {
  if (typeof valor === 'string') return redigirTexto(valor);
  if (valor === null || typeof valor !== 'object' || profundidade > 6) return valor;
  if (Array.isArray(valor)) return valor.map((v) => redigirSegredos(v, profundidade + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (chaveSensivel(k)) continue;
    out[k] = redigirSegredos(v, profundidade + 1);
  }
  return out;
}

/** Limite de AuditLog.detalhes. */
const MAX_DETALHES = 2000;

/**
 * Serializa os detalhes sempre como JSON válido dentro do limite (a tela faz JSON.parse). Quando
 * não cabe, grava um resumo com marcador de truncamento e as chaves de primeiro nível que couberem.
 */
function serializarDetalhes(valor: unknown): string {
  const json = JSON.stringify(valor ?? {}) ?? '{}';
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

/** Id para AuditLog.entidade_id (Int): o primeiro candidato que for inteiro positivo; senão null. */
function idInteiro(...candidatos: unknown[]): number | null {
  for (const c of candidatos) {
    if (c === null || c === undefined || c === '' || typeof c === 'boolean') continue;
    const n = Number(c);
    if (Number.isInteger(n) && n > 0 && n <= 2147483647) return n;
  }
  return null;
}

/**
 * Segmentos de URL reconhecidos → slug gravado em AuditLog.modulo. Os slugs são os mesmos que os
 * services gravam via AuditoriaService.registrar, para o filtro por módulo da tela ficar coerente.
 */
const MODULOS_POR_SEGMENTO: Record<string, string> = {
  visitantes: 'visitantes',
  visitas: 'visitas',
  pessoas: 'pessoas',
  encomendas: 'encomendas',
  moradores: 'moradores',
  apartamentos: 'apartamentos',
  vagas: 'vagas',
  veiculos: 'veiculos',
  tags: 'tags',
  ocorrencias: 'ocorrencias',
  comunicados: 'comunicados',
  prestadores: 'prestadores',
  delivery: 'delivery',
  convites: 'convites',
  financeiro: 'financeiro',
  assembleias: 'assembleias',
  documentos: 'documentos',
  mudancas: 'mudancas',
  'areas-sociais': 'areas-sociais',
  areassociais: 'areas-sociais',
  facial: 'facial',
  'regras-acesso': 'regras-acesso',
  'caminhos-acesso': 'caminhos-acesso',
  consentimentos: 'consentimentos',
  funcionarios: 'funcionarios',
  sindico: 'sindico',
  users: 'users',
  condominio: 'condominios',
  agenda: 'agenda',
  contatos: 'contatos',
  notificacoes: 'notificacoes',
  'chat-ia': 'chat-ia',
  auth: 'auth',
  dashboard: 'dashboard',
  relatorios: 'relatorios',
  crm: 'crm',
};

/** Rota para a descrição: sem query string; segmento que não é palavra de rota nem número vira `:valor`. */
function rotaSemValores(segments: string[]): string {
  const rota = segments
    .map((s) => (/^\d{1,12}$/.test(s) || /^[A-Za-z][A-Za-z-]{0,39}$/.test(s) ? s : ':valor'))
    .join('/');
  return `/${rota}`.substring(0, 120);
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    @Optional() private readonly tenant?: TenantAccessService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, params, user } = request;

    // Apenas operações de escrita
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isWriteOperation) {
      return next.handle();
    }

    // Service do endpoint grava auditoria explícita com contexto rico —
    // não duplica gravando log genérico aqui.
    const skipAudit = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipAudit) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: async (response) => {
          try {
            if (!this.prisma.isConnected) return;

            const clientIp = extractClientIp(request);

            // Extrair info do usuário do JWT payload
            const jwtPayload = user?.user ?? user ?? {};
            const idCondominio = await this.condominioDoRegistro(user, jwtPayload, params, body);

            // Nome e e-mail do porteiro/síndico
            const usuarioNome: string = jwtPayload?.nome ?? jwtPayload?.name ?? 'Sistema';
            const usuarioEmail: string | undefined = jwtPayload?.email ?? undefined;
            // Id + tabela de quem fez a ação. Lê o token inteiro (não o `user` aninhado): tipo_sub,
            // role e typeAccess ficam na raiz.
            const autor = autorDoToken(user);

            const auditInfo = this.parseRequest(method, url, body, params, response);

            // Só grava se tiver condomínio identificado e entidade relevante
            if (!idCondominio) return;

            await this.prisma.auditLog.create({
              data: {
                id_condominio: idCondominio,
                usuario_nome: usuarioNome,
                usuario_email: usuarioEmail ?? null,
                autor_id: autor.autor_id,
                autor_tipo: autor.autor_tipo,
                acao: auditInfo.action,
                modulo: auditInfo.module,
                entidade_id: auditInfo.entityId,
                descricao: auditInfo.descricao,
                detalhes: auditInfo.details,
                ip: clientIp || null,
              },
            });
          } catch (err) {
            console.error('[AuditInterceptor] Erro ao gravar log:', err);
          }
        },
      }),
    );
  }

  /**
   * Condomínio em que o registro é gravado. Nunca o corpo sozinho: token de app e de CRM não trazem
   * id_condominio, e o fallback para body.id_condominio deixava qualquer usuário escrever no log de
   * auditoria de OUTRO condomínio (ex.: POST /users/remove-fcm-token com {"id_condominio": B}).
   *  1. id_condominio do token (console/portaria);
   *  2. :idCondominio da URL ou id_condominio do corpo, só para token de usuário do app e só com o
   *     vínculo conferido no banco (TenantAccessService). Sem vínculo: não grava.
   */
  private async condominioDoRegistro(user: any, jwtPayload: any, params: any, body: any): Promise<number> {
    const doToken = Number(user?.id_condominio ?? jwtPayload?.id_condominio ?? 0);
    if (doToken) return doToken;
    if (!user || !this.tenant || !idUsuarioDoToken(user)) return 0;
    const alvo = Number(params?.idCondominio ?? body?.id_condominio ?? 0);
    if (!alvo) return 0;
    try {
      await this.tenant.assertCondominio(alvo, user);
      return alvo;
    } catch {
      return 0;
    }
  }

  private parseRequest(method: string, url: string, body: any, params: any, response: any) {
    const cleanUrl = url.split('?')[0];
    const segments = cleanUrl.split('/').filter((s) => s && s !== 'api');

    let module = 'sistema';
    let action = 'EXECUTE';
    let descricao = 'Ação realizada no sistema';

    // Identifica o módulo a partir da URL
    // Exemplos: /api/condominios/7/visitantes → visitantes
    //           /api/encomendas/retirar → encomendas
    // Igualdade de segmento (não prefixo): `auth` não pode casar `authorize-…`.
    for (const seg of segments) {
      const m = MODULOS_POR_SEGMENTO[seg.toLowerCase()];
      if (m) { module = m; break; }
    }

    // Identifica a ação
    if (method === 'DELETE') {
      action = 'DELETE';
    } else if (method === 'POST') {
      action = 'CREATE';
      if (cleanUrl.includes('/update') || cleanUrl.includes('/edit')) action = 'UPDATE';
      if (cleanUrl.includes('/remove') || cleanUrl.includes('/delete')) action = 'DELETE';
      if (cleanUrl.includes('/check-in') || cleanUrl.includes('/checkin')) action = 'CHECK_IN';
      if (cleanUrl.includes('/check-out') || cleanUrl.includes('/checkout') || cleanUrl.includes('/dar-baixa')) action = 'CHECK_OUT';
      if (cleanUrl.includes('/retirar') || cleanUrl.includes('/entregar')) action = 'RETIRADA';
      if (cleanUrl.includes('/responder') || cleanUrl.includes('/resposta')) action = 'RESPOSTA';
      if (cleanUrl.includes('/status') || cleanUrl.includes('/update-status')) action = 'STATUS';
    } else if (method === 'PUT' || method === 'PATCH') {
      action = 'UPDATE';
    }

    // Monta descrição legível
    const moduleLabel = this.getModuleLabel(module);
    const actionLabel = this.getActionLabel(action);
    const nome = body?.nome ?? body?.descricao ?? body?.titulo ?? response?.nome ?? response?.descricao ?? '';
    // Módulo desconhecido: método e rota são a única pista do que foi feito.
    const onde = module === 'sistema' ? `${moduleLabel} (${method} ${rotaSemValores(segments)})` : moduleLabel;
    descricao = nome
      ? `${actionLabel} em ${onde}: "${nome}"`
      : `${actionLabel} em ${onde}`;

    // Entity ID — nunca NaN: o Prisma rejeita e o log inteiro se perde.
    const entityId = idInteiro(response?.id, body?.id, params?.id);

    // Detalhes (sem dados sensíveis)
    const cleanDetails = redigirSegredos(body);

    return {
      module,
      action,
      entityId,
      descricao,
      details: serializarDetalhes(cleanDetails),
    };
  }

  private getModuleLabel(module: string): string {
    const labels: Record<string, string> = {
      visitantes: 'Visitantes',
      encomendas: 'Encomendas',
      moradores: 'Moradores',
      apartamentos: 'Apartamentos',
      ocorrencias: 'Ocorrências',
      comunicados: 'Comunicados',
      prestadores: 'Prestadores',
      financeiro: 'Financeiro',
      assembleias: 'Assembleias',
      documentos: 'Documentos',
      mudancas: 'Mudanças',
      'areas-sociais': 'Áreas Sociais',
      auth: 'Autenticação',
      visitas: 'Visitas',
      pessoas: 'Pessoas',
      vagas: 'Vagas',
      veiculos: 'Veículos',
      tags: 'Tags de Veículo',
      delivery: 'Delivery',
      convites: 'Convites',
      facial: 'Reconhecimento Facial',
      'regras-acesso': 'Regras de Acesso',
      'caminhos-acesso': 'Caminhos de Acesso',
      consentimentos: 'Consentimentos',
      funcionarios: 'Funcionários',
      sindico: 'Síndico',
      users: 'Conta do Usuário',
      condominios: 'Condomínio',
      agenda: 'Agenda',
      contatos: 'Contatos',
      notificacoes: 'Notificações',
      'chat-ia': 'Assistente IA',
      dashboard: 'Dashboard',
      relatorios: 'Relatórios',
      crm: 'CRM',
      sistema: 'Sistema',
    };
    return labels[module] ?? module;
  }

  private getActionLabel(action: string): string {
    const labels: Record<string, string> = {
      CREATE: 'Criação',
      UPDATE: 'Atualização',
      DELETE: 'Remoção',
      CHECK_IN: 'Check-in',
      CHECK_OUT: 'Check-out',
      RETIRADA: 'Retirada',
      RESPOSTA: 'Resposta',
      STATUS: 'Mudança de status',
      EXECUTE: 'Execução',
    };
    return labels[action] ?? action;
  }
}
