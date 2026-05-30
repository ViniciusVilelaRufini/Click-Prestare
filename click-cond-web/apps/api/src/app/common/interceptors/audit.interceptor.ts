import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
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

            const clientIp =
              (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
              request.ip ||
              '';

            // Extrair info do usuário do JWT payload
            const jwtPayload = user?.user ?? user ?? {};
            const idCondominio: number =
              Number(jwtPayload?.id_condominio ?? body?.id_condominio ?? 0);

            // Nome e e-mail do porteiro/síndico
            const usuarioNome: string = jwtPayload?.nome ?? jwtPayload?.name ?? 'Sistema';
            const usuarioEmail: string | undefined = jwtPayload?.email ?? undefined;

            const auditInfo = this.parseRequest(method, url, body, params, response);

            // Só grava se tiver condomínio identificado e entidade relevante
            if (!idCondominio) return;

            await this.prisma.auditLog.create({
              data: {
                id_condominio: idCondominio,
                usuario_nome: usuarioNome,
                usuario_email: usuarioEmail ?? null,
                acao: auditInfo.action,
                modulo: auditInfo.module,
                entidade_id: auditInfo.entityId,
                descricao: auditInfo.descricao,
                detalhes: auditInfo.details,
                ip: typeof clientIp === 'string' ? clientIp.substring(0, 45) : '',
              },
            });
          } catch (err) {
            console.error('[AuditInterceptor] Erro ao gravar log:', err);
          }
        },
      }),
    );
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
    const knownModules = [
      'visitantes', 'encomendas', 'moradores', 'apartamentos',
      'ocorrencias', 'comunicados', 'prestadores', 'financeiro',
      'assembleias', 'documentos', 'mudancas', 'areas-sociais',
      'auth', 'dashboard', 'relatorios',
    ];

    for (const seg of segments) {
      const m = knownModules.find((k) => seg.startsWith(k));
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
    descricao = nome
      ? `${actionLabel} em ${moduleLabel}: "${nome}"`
      : `${actionLabel} em ${moduleLabel}`;

    // Entity ID
    let entityId: number | null = null;
    if (response?.id) entityId = Number(response.id);
    else if (body?.id) entityId = Number(body.id);
    else if (params?.id) entityId = Number(params.id);

    // Detalhes (sem dados sensíveis)
    const cleanDetails = { ...body };
    delete cleanDetails.password;
    delete cleanDetails.senha;
    delete cleanDetails.photo;
    delete cleanDetails.retirado_foto;
    delete cleanDetails.retirado_assinatura;
    delete cleanDetails.assinatura;
    delete cleanDetails.foto;

    return {
      module,
      action,
      entityId,
      descricao,
      details: JSON.stringify(cleanDetails).substring(0, 2000),
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
