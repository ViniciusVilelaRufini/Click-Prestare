import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { ChatIaService } from './chat-ia.service';

/**
 * Assistente IA do app (tela ChatIaPage).
 *
 * O escopo dos dados sai do JWT, não do corpo: o cliente só escolhe o
 * condomínio (validado contra o vínculo real) e a pergunta.
 */
@Controller('chat-ia')
export class ChatIaController {
  constructor(private readonly service: ChatIaService) {}

  // Cada pergunta gera 2 chamadas pagas ao Gemini (embedding + geração).
  // 12/min por IP segura conversa normal e limita abuso/custo.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('perguntar')
  @HttpCode(200)
  perguntar(
    @Body() body: { id_condominio?: string | number; pergunta?: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.responder(
      Number(body?.id_condominio),
      body?.pergunta ?? '',
      payload,
    );
  }

  /**
   * Executa a ação que o assistente propôs, depois do toque em Confirmar.
   *
   * A proposta carrega dono e condomínio; o service compara com o JWT antes
   * de executar. O corpo só diz QUAL proposta — nunca o que fazer.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('confirmar')
  @HttpCode(200)
  confirmar(
    @Body() body: { id_condominio?: string | number; id_acao?: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.confirmarAcao(
      Number(body?.id_condominio),
      String(body?.id_acao ?? ''),
      payload,
    );
  }

  // Reprocessa atas/documentos para a busca semântica. Só síndico.
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('reindex')
  @HttpCode(200)
  reindex(
    @Body() body: { id_condominio?: string | number },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.reindexCondominio(Number(body?.id_condominio), payload);
  }
}
