import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Optional, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';
import { extractClientIp } from '../context/request-context';
import { TenantAccessService } from '../../auth/tenant-access.service';
import { autorDoToken, idUsuarioDoToken } from '../../auth/usuario-do-token.util';
import {
  LIMITES_AUDITORIA,
  cortar,
  redigirSegredos,
  serializarDetalhes,
} from '../auditoria-redacao.util';

// Mantido para quem importava daqui (a implementação mora em common/auditoria-redacao.util.ts,
// compartilhada com AuditoriaService.registrar).
export { redigirSegredos } from '../auditoria-redacao.util';

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
  entrega: 'delivery',
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
  condominios: 'condominios',
  credenciais: 'credenciais',
  passes: 'credenciais',
  wallet: 'credenciais',
  'card-ao-vivo': 'portaria-remota',
  guarita: 'guarita',
  // Equipe da portaria: mesmo slug que mobile-auth.service grava.
  portaria: 'portaria-equipe',
  agenda: 'agenda',
  contatos: 'contatos',
  notificacoes: 'notificacoes',
  'chat-ia': 'chat-ia',
  auth: 'auth',
  dashboard: 'dashboard',
  relatorios: 'relatorios',
  crm: 'crm',
};

/** Módulo-contêiner: quase toda rota passa por /condominios/:id; só vale quando nada mais específico casa. */
const MODULO_CONTEINER = 'condominios';

/**
 * Último segmento literal de um POST que executa um comando sobre algo que já existe (não cria
 * registro). Gravado como STATUS com "Ação '<verbo>' em <Módulo>" em vez de "Criação em ...".
 */
const VERBOS_DE_COMANDO = new Set([
  'trigger',
  'cancelar',
  'aprovar',
  'rejeitar',
  'recusar',
  'vincular',
  'desvincular',
  'regravar',
  'abrir',
  'sair',
  'reenviar',
  'revogar',
  'enviar',
  'reabrir',
  'encerrar',
  'autorizar',
  'negar',
  'test',
  'testar',
]);

/** Prefixos de verbo de comando: `revogar-biometria`, `revogar-acesso`… */
const PREFIXOS_DE_COMANDO = ['revogar-'];

function verboDeComando(segmento: string): boolean {
  return VERBOS_DE_COMANDO.has(segmento) || PREFIXOS_DE_COMANDO.some((p) => segmento.startsWith(p));
}

/**
 * Segmentos "âncora": quando aparecem no caminho, o módulo é o deles, mesmo havendo outro
 * reconhecido depois (/consentimentos/moradores/:id/revogar-biometria é Consentimentos, não Moradores).
 */
const SEGMENTOS_ANCORA = new Set(['consentimentos']);

/** Rota para a descrição: sem query string; segmento que não é palavra de rota nem número vira `:valor`. */
function rotaSemValores(segments: string[]): string {
  const rota = segments
    .map((s) => (/^\d{1,12}$/.test(s) || /^[A-Za-z][A-Za-z-]{0,39}$/.test(s) ? s : ':valor'))
    .join('/');
  return `/${rota}`.substring(0, 120);
}

/**
 * Módulo da rota: o segmento reconhecido MAIS ESPECÍFICO (o último no caminho), para
 * /condominios/:id/apartamentos/:id/vagas ser 'vagas' e não 'apartamentos'. 'condominios' só
 * quando é o único reconhecido. Igualdade de segmento (não prefixo): `auth` não casa `authorize-…`.
 */
function moduloDaRota(segments: string[]): string {
  let module = 'sistema';
  let conteiner = false;
  const ancora = segments.find((s) => SEGMENTOS_ANCORA.has(s.toLowerCase()));
  if (ancora) return MODULOS_POR_SEGMENTO[ancora.toLowerCase()];
  for (const seg of segments) {
    const m = MODULOS_POR_SEGMENTO[seg.toLowerCase()];
    if (!m) continue;
    if (m === MODULO_CONTEINER) conteiner = true;
    else module = m;
  }
  return module === 'sistema' && conteiner ? MODULO_CONTEINER : module;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

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
          let auditInfo: ReturnType<AuditInterceptor['parseRequest']> | undefined;
          try {
            auditInfo = this.parseRequest(method, url, body, params, response);

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

            // Só grava se tiver condomínio identificado e entidade relevante
            if (!idCondominio) return;

            if (!this.prisma.isConnected) {
              // Sem DATABASE_URL é o modo offline de desenvolvimento (mocks): não é falha.
              if (process.env['DATABASE_URL']) {
                this.logger.error(
                  `AUDITORIA_FALHA modulo=${auditInfo.module} acao=${auditInfo.action}: banco desconectado, registro perdido`,
                );
              }
              return;
            }

            await this.prisma.auditLog.create({
              data: {
                id_condominio: idCondominio,
                usuario_nome: cortar(usuarioNome, LIMITES_AUDITORIA.usuario_nome) as string,
                usuario_email: cortar(usuarioEmail, LIMITES_AUDITORIA.usuario_email),
                autor_id: autor.autor_id,
                autor_tipo: autor.autor_tipo,
                acao: auditInfo.action,
                modulo: auditInfo.module,
                entidade_id: auditInfo.entityId,
                descricao: cortar(auditInfo.descricao, LIMITES_AUDITORIA.descricao) as string,
                detalhes: auditInfo.details,
                ip: cortar(clientIp || null, LIMITES_AUDITORIA.ip),
              },
            });
          } catch (err: any) {
            // Nunca lança para o chamador, mas alerta (o alarme conta linhas ERROR). Sem detalhes.
            this.logger.error(
              `AUDITORIA_FALHA modulo=${auditInfo?.module ?? '?'} acao=${auditInfo?.action ?? '?'}: ${err?.message ?? err}`,
            );
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

    // Exemplos: /api/condominios/7/visitantes → visitantes
    //           /api/condominios/7/apartamentos/4/vagas → vagas
    //           /api/encomendas/retirar → encomendas
    const module = moduloDaRota(segments);

    let action = 'EXECUTE';
    // Verbo de comando no fim da rota de um POST (ex.: /wallet/cancelar, /dispositivos/3/aprovar).
    let comando: string | null = null;

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
      const ultimo = (segments[segments.length - 1] ?? '').toLowerCase();
      if (action === 'CREATE' && verboDeComando(ultimo)) {
        action = 'STATUS';
        comando = ultimo;
      }
    } else if (method === 'PUT' || method === 'PATCH') {
      action = 'UPDATE';
    }

    // Monta descrição legível
    const moduleLabel = this.getModuleLabel(module);
    const actionLabel = this.getActionLabel(action);
    const nome = body?.nome ?? body?.descricao ?? body?.titulo ?? response?.nome ?? response?.descricao ?? '';
    // Módulo desconhecido: método e rota são a única pista do que foi feito.
    const onde = module === 'sistema' ? `${moduleLabel} (${method} ${rotaSemValores(segments)})` : moduleLabel;
    const oQue = comando ? `Ação '${comando}' em ${onde}` : `${actionLabel} em ${onde}`;
    const descricao = nome ? `${oQue}: "${nome}"` : oQue;

    // Entity ID — nunca NaN: o Prisma rejeita e o log inteiro se perde.
    const entityId = idInteiro(response?.id, body?.id, params?.id);

    // Detalhes (sem segredos; documento e telefone mascarados)
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
      credenciais: 'Credenciais',
      'portaria-remota': 'Portaria Remota',
      guarita: 'Guarita',
      'portaria-equipe': 'Equipe da Portaria',
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
