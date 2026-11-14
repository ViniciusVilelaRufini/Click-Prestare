import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { SkipAudit } from '../../common/interceptors/skip-audit.decorator';
import { DeliveryPortaoService } from './delivery-portao.service';

/**
 * Página pública do entregador no portão (QR de entregas).
 *
 * O token do portão (`:token`) está impresso no portão: é público por
 * natureza e pode ir no caminho. O token do PEDIDO, que só a página do
 * entregador conhece, vai sempre no corpo do POST (`{ pedido }`), nunca no
 * caminho nem na query: assim não aparece em log de acesso, CDN ou Referer.
 *
 * @SkipAudit: sem usuário autenticado, o AuditInterceptor não tem onde gravar
 * (cada passo já fica em DeliveryEventos e Acessos_Facial). O corpo é lido
 * campo a campo; o resto é ignorado.
 */
@Controller('entrega/publico')
export class EntregaPublicoController {
  constructor(private readonly service: DeliveryPortaoService) {}

  @SkipAudit()
  @Public()
  @Get(':token')
  ler(@Param('token') token: string) {
    return this.service.lerPortao(token);
  }

  @SkipAudit()
  @Public()
  @Throttle({ medium: { limit: 5, ttl: 600_000 } })
  @Post(':token')
  @HttpCode(200)
  criar(
    @Param('token') token: string,
    @Body() body: { id_apartamento?: unknown; nome?: unknown; plataforma?: unknown; foto?: unknown },
  ) {
    return this.service.criarPedido(token, {
      id_apartamento: body?.id_apartamento,
      nome: body?.nome,
      plataforma: body?.plataforma,
      foto: body?.foto,
    });
  }

  /** Consulta da página (a cada ~3 s): é também a presença do entregador. */
  @SkipAudit()
  @Public()
  @Post(':token/pedido')
  @HttpCode(200)
  consultar(@Param('token') token: string, @Body() body: { pedido?: unknown }) {
    return this.service.consultar(token, tokenDoPedido(body));
  }

  @SkipAudit()
  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post(':token/pedido/abrir')
  @HttpCode(200)
  abrir(@Param('token') token: string, @Body() body: { pedido?: unknown }) {
    return this.service.abrir(token, tokenDoPedido(body));
  }

  @SkipAudit()
  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post(':token/pedido/sair')
  @HttpCode(200)
  sair(@Param('token') token: string, @Body() body: { pedido?: unknown }) {
    return this.service.sair(token, tokenDoPedido(body));
  }
}

/** Só string; qualquer outra coisa vira '' (o serviço responde 404). */
function tokenDoPedido(body: { pedido?: unknown } | undefined): string {
  return typeof body?.pedido === 'string' ? body.pedido : '';
}
