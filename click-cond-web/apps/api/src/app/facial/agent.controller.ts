import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { FacialService } from './facial.service';
import { AgentBridgeService, AgentResult } from './agent-bridge.service';

/**
 * Endpoints consumidos pelo Agente Local (ver agent/ e AgentBridgeService).
 *
 * Autenticação: o agente usa o webhook_token do device (já é um segredo de 32
 * bytes). Mesmo limite de confiança do webhook — quem tem o token opera o
 * device. Todo o tráfego é HTTPS em produção.
 *
 * Fluxo do agente, por device que ele gerencia:
 *   - GET  /facial/agent/:token/poll    → heartbeat + comandos pendentes + config LAN
 *   - POST /facial/agent/:token/result  → devolve o resultado de um comando
 */
// Polling do agente é tráfego de máquina (a cada ~2s) e autenticado por token.
// Fica fora do rate-limit global para não consumir o orçamento por IP que o
// webhook de acesso e o app do porteiro compartilham (mesma IP do condomínio).
@SkipThrottle()
@Controller('facial/agent')
export class AgentController {
  constructor(
    private readonly service: FacialService,
    private readonly bridge: AgentBridgeService,
  ) {}

  @Public()
  @Get(':token/poll')
  async poll(@Param('token') token: string) {
    const device = await this.service.findDeviceByToken(token);
    const commands = this.bridge.poll(device.id);
    return {
      device: {
        id: device.id,
        nome: device.nome,
        tipo: device.tipo,
        fabricante: device.fabricante,
        ip: device.ip,
        porta: device.porta,
        api_user: device.api_user,
        api_password: device.api_password,
      },
      commands,
      poll_interval_ms: this.bridge.pollIntervalMs,
    };
  }

  @Public()
  @Post(':token/result')
  async result(
    @Param('token') token: string,
    @Body() body: { commandId: string } & AgentResult,
  ) {
    // Valida o token (lança se inválido) antes de aceitar o resultado.
    await this.service.findDeviceByToken(token);
    const { commandId, ...result } = body ?? ({} as any);
    if (commandId) this.bridge.submitResult(commandId, result);
    return { ok: true };
  }
}
