import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { GuaritaAgenteService } from './guarita-agente.service';

/**
 * Rotas do Agente Local para o Módulo Guarita (contrato fixo com o driver
 * `linear-guarita`):
 *
 *   GET  .../operacoes                → { operacoes: [{ id, tipo, frame_hex? }] }
 *   POST .../operacoes/:id/resultado  ← { ok, codigo?, erro?, frames_hex?, parte?, fim? }
 *   POST .../eventos                  ← { eventos: [{ frame_hex, origem, recebido_em }], relogio_delta_s } → { aceitos }
 *   POST .../nao-cadastrado           ← { comando, tipo, serial_hex, contador, receptor, bateria_fraca, recebido_em }
 *   POST .../estado                   ← { conectado, autorizado, firmware?, total_dispositivos?, total_eventos?, relogio_delta_s?, erro? }
 *
 * Autenticação igual às outras rotas `condo/:token/*` (AgentController): o
 * token do agente; `:deviceId` tem de ser um Guarita ativo do condomínio do
 * token (senão 404). Tráfego de máquina: fora do rate-limit por IP, como o poll.
 *
 * O evento do Guarita NUNCA passa por runWebhook/processAgentEvent nem aciona
 * relé: o Guarita já decidiu e abriu o portão — aqui só se registra.
 */
@SkipThrottle({ short: true, medium: true })
@Controller('facial/agent/condo/:token/guarita/:deviceId')
export class GuaritaAgenteController {
  constructor(private readonly service: GuaritaAgenteService) {}

  @Public()
  @Get('operacoes')
  async operacoes(@Param('token') token: string, @Param('deviceId') deviceId: string) {
    const device = await this.service.resolverGuarita(token, deviceId);
    return this.service.buscarOperacoes(device);
  }

  @Public()
  @SkipAudit()
  @Post('operacoes/:idOperacao/resultado')
  async resultado(
    @Param('token') token: string,
    @Param('deviceId') deviceId: string,
    @Param('idOperacao') idOperacao: string,
    @Body() body: unknown,
  ) {
    const device = await this.service.resolverGuarita(token, deviceId);
    return this.service.registrarResultado(device, idOperacao, body);
  }

  @Public()
  @SkipAudit()
  @Post('eventos')
  async eventos(@Param('token') token: string, @Param('deviceId') deviceId: string, @Body() body: unknown) {
    const device = await this.service.resolverGuarita(token, deviceId);
    return this.service.registrarEventos(device, body);
  }

  @Public()
  @SkipAudit()
  @Post('nao-cadastrado')
  async naoCadastrado(@Param('token') token: string, @Param('deviceId') deviceId: string, @Body() body: unknown) {
    const device = await this.service.resolverGuarita(token, deviceId);
    return this.service.registrarNaoCadastrado(device, body);
  }

  @Public()
  @SkipAudit()
  @Post('estado')
  async estado(@Param('token') token: string, @Param('deviceId') deviceId: string, @Body() body: unknown) {
    const device = await this.service.resolverGuarita(token, deviceId);
    return this.service.registrarEstado(device, body);
  }
}
