import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, params, user } = request;

    // We only audit write operations
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isWriteOperation) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: async (response) => {
          try {
            // Avoid auditing if database is not connected
            if (!this.prisma.isConnected) return;

            const clientIp = request.ip || request.headers['x-forwarded-for'] || '';
            const userId = user?.user?.id ?? user?.sub ?? null;

            const auditInfo = this.parseRequest(method, url, body, params, response);

            await this.prisma.auditoria.create({
              data: {
                id_user: userId ? Number(userId) : null,
                acao: auditInfo.action,
                entidade: auditInfo.entity,
                entidade_id: auditInfo.entityId,
                detalhes: auditInfo.details,
                ip: typeof clientIp === 'string' ? clientIp.substring(0, 45) : '',
              },
            });
          } catch (err) {
            // Silently handle audit errors to avoid failing the main request
            console.error('AuditInterceptor error:', err);
          }
        },
      }),
    );
  }

  private parseRequest(method: string, url: string, body: any, params: any, response: any) {
    const cleanUrl = url.split('?')[0];
    const segments = cleanUrl.split('/').filter(s => s && s !== 'api');

    let entity = 'Sistema';
    let action = 'EXECUTE';

    if (segments.length > 0) {
      const resource = segments[0];
      entity = resource.charAt(0).toUpperCase() + resource.slice(1);

      if (method === 'POST') {
        action = 'CREATE';
        if (cleanUrl.includes('update')) action = 'UPDATE';
        if (cleanUrl.includes('remove') || cleanUrl.includes('delete')) action = 'DELETE';
      } else if (method === 'PUT' || method === 'PATCH') {
        action = 'UPDATE';
        if (cleanUrl.includes('retirar')) action = 'RETIRAR';
        if (cleanUrl.includes('dar-baixa') || cleanUrl.includes('baixa')) action = 'DAR_BAIXA';
      } else if (method === 'DELETE') {
        action = 'DELETE';
      }
    }

    let entityId: number | null = null;
    if (body?.id) {
      entityId = Number(body.id);
    } else if (body?.financeiro?.id) {
      entityId = Number(body.financeiro.id);
    } else if (params?.id) {
      entityId = Number(params.id);
    } else if (response?.id) {
      entityId = Number(response.id);
    }

    const cleanDetails = { ...body };
    delete cleanDetails.password;
    delete cleanDetails.senha;
    delete cleanDetails.photo;
    delete cleanDetails.retirado_foto;
    delete cleanDetails.retirado_assinatura;
    delete cleanDetails.assinatura;

    return {
      entity,
      action,
      entityId,
      details: JSON.stringify(cleanDetails).substring(0, 1000), // safety truncate
    };
  }
}
