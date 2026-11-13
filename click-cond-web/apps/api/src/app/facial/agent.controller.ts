import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import {
  FacialService,
  WebhookEventDto,
  normalizarFabricante,
} from './facial.service';
import { AgentBridgeService, AgentResult } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';
import { DescobertaService } from './descoberta.service';

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
@SkipThrottle({ short: true, medium: true })
@Controller('facial/agent')
export class AgentController {
  constructor(
    private readonly service: FacialService,
    private readonly bridge: AgentBridgeService,
    private readonly agentVersion: AgentVersionService,
    private readonly descoberta: DescobertaService,
  ) {}

  @Public()
  @Get(':token/poll')
  async poll(@Param('token') token: string) {
    const device = await this.service.findDeviceByToken(token);
    // Detecta a (re)conexão do agente: se estava offline e agora fez poll,
    // dispara o back-fill dos rostos pendentes desse condomínio em background.
    // É o que torna plug-and-play: ligou o agente → as fotos já cadastradas
    // sobem para o facial sozinhas.
    const reconectou = !this.bridge.isOnline(device.id);
    const commands = await this.bridge.poll(device.id);
    if (reconectou && device.tipo === 'facial') {
      // Terminal com CARGA PENDENTE (`ultima_sincr` nulo: novo, reativado ou
      // reendereçado que ainda não recebeu todo mundo): carga completa só dele.
      // "Pendente" do back-fill é por pessoa — quem já está 'synced' pelos
      // outros terminais nunca chegaria neste.
      void this.service.syncAllForCondominio(
        device.id_condominio,
        device.ultima_sincr === null ? { deviceIds: [device.id] } : { onlyPending: true },
      );
    }
    return {
      device: {
        id: device.id,
        nome: device.nome,
        tipo: device.tipo,
        // O agente escolhe o protocolo por esta string; `dahua` e `intelbras`
        // são o mesmo firmware (ver normalizarFabricante).
        fabricante: normalizarFabricante(device.fabricante),
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
    const device = await this.service.findDeviceByToken(token);
    const { commandId, ...result } = body ?? ({} as any);
    // O token é DESTE device: só resolve comando dele. Comando de outro device
    // é tratado como desconhecido (mesma resposta, sem efeito).
    if (commandId) await this.bridge.submitResult(commandId, result, [device.id]);
    return { ok: true };
  }

  // ----- Modo condomínio: UM token gerencia TODOS os dispositivos do condomínio -----
  // Mais simples de configurar (o agente precisa de 1 token só). O token é o
  // agent_token do condomínio. O webhook_token de um dispositivo ainda é
  // aceito (agente antigo), mas só enxerga e age sobre aquele dispositivo.
  // Continua isolado por condomínio (o token só enxerga o próprio tenant).

  @Public()
  @Get('condo/:token/poll')
  async condoPoll(@Param('token') token: string) {
    const { idCondominio, soDispositivo } = await this.escopo(token);
    const todos = await this.service.getActiveDevices(idCondominio);
    const devices = soDispositivo == null ? todos : todos.filter((d) => d.id === soDispositivo);
    // Antes do poll (que marca o heartbeat): quem estava offline até agora.
    const reconectados = new Set(devices.filter((d) => !this.bridge.isOnline(d.id)).map((d) => d.id));
    // Uma leitura da fila para o condomínio inteiro, em vez de uma por device.
    const comandos = await this.bridge.pollVarios(devices.map((d) => d.id));
    // Faciais reconectados com CARGA PENDENTE (`ultima_sincr` nulo — ver
    // FacialService.agendarCargaDoTerminal): carga completa restrita a eles.
    // Uma chamada só, porque cabe uma sincronização em massa por condomínio;
    // o back-fill dos demais reconectados vem em seguida.
    const faciaisReconectados = devices.filter((d) => reconectados.has(d.id) && d.tipo === 'facial');
    const cargaPendente = faciaisReconectados.filter((d) => d.ultima_sincr === null).map((d) => d.id);
    if (cargaPendente.length > 0) {
      const haOutros = faciaisReconectados.length > cargaPendente.length;
      void Promise.resolve(this.service.syncAllForCondominio(idCondominio, { deviceIds: cargaPendente }))
        .catch(() => undefined)
        .then(() =>
          haOutros ? this.service.syncAllForCondominio(idCondominio, { onlyPending: true }) : undefined,
        )
        .catch(() => undefined);
    }
    const out = devices.map((d) => {
      const commands = comandos.get(d.id) ?? [];
      if (cargaPendente.length === 0 && reconectados.has(d.id) && d.tipo === 'facial') {
        void this.service.syncAllForCondominio(idCondominio, {
          onlyPending: true,
        });
      }
      return {
        device: {
          id: d.id,
          nome: d.nome,
          tipo: d.tipo,
          fabricante: normalizarFabricante(d.fabricante),
          ip: d.ip,
          porta: d.porta,
          api_user: d.api_user,
          api_password: d.api_password,
        },
        commands,
      };
    });
    return {
      devices: out,
      poll_interval_ms: this.bridge.pollIntervalMs,
      // Etapa 3: pedido de descoberta feito pelo portal (DescobertaService.pedirProcura).
      // Consumido aqui — true só uma vez por pedido — para o agente disparar a varredura da LAN.
      // A descoberta é do condomínio inteiro: só o agent_token consome o pedido.
      descobrir: soDispositivo == null ? await this.descoberta.consumirPedido(idCondominio) : false,
      // "Atualizar agora" do portal (AgentBridgeService.pedirVerificacaoDeAtualizacao):
      // true só uma vez por pedido, para o agente conferir a versão já. Agente antigo ignora.
      // Pedido do condomínio inteiro (como a descoberta): só o agent_token consome.
      verificar_atualizacao:
        soDispositivo == null ? await this.bridge.consumirPedidoDeAtualizacao(idCondominio) : false,
    };
  }

  @Public()
  @Post('condo/:token/result')
  async condoResult(
    @Param('token') token: string,
    @Body() body: { commandId: string } & AgentResult,
  ) {
    const { idCondominio, soDispositivo } = await this.escopo(token);
    const { commandId, ...result } = body ?? ({} as any);
    if (commandId) {
      // Só resolve comando de device DESTE condomínio (ou só do dispositivo do token); de outro é
      // tratado como comando desconhecido (mesma resposta, sem efeito).
      const ids =
        soDispositivo != null ? [soDispositivo] : (await this.service.getActiveDevices(idCondominio)).map((d) => d.id);
      await this.bridge.submitResult(commandId, result, ids);
    }
    return { ok: true };
  }

  /**
   * Evento de acesso repassado pelo Agente Local. Aparelhos Dahua/Intelbras não
   * fazem push HTTP para uma URL: o agente assina o stream do aparelho e manda
   * cada acesso aqui (deviceId + external_id do rosto reconhecido).
   */
  @Public()
  @Post('condo/:token/event')
  async condoEvent(
    @Param('token') token: string,
    @Body() body: { deviceId: number } & WebhookEventDto,
  ) {
    const { deviceId, ...payload } = body ?? ({} as any);
    return this.service.processAgentEvent(token, Number(deviceId), payload);
  }

  /**
   * Heartbeat de status dos aparelhos: o agente pinga cada device na LAN a cada
   * ~20s e reporta aqui, para o portal mostrar online/offline automaticamente
   * (sem o operador clicar "Testar Conexão").
   */
  @Public()
  @Post('condo/:token/device-status')
  async condoDeviceStatus(
    @Param('token') token: string,
    @Body() body: { statuses?: { deviceId: number; online: boolean }[] },
  ) {
    const { idCondominio, soDispositivo } = await this.escopo(token);
    const statuses = body?.statuses ?? [];
    return this.service.reportDeviceStatuses(
      idCondominio,
      soDispositivo == null ? statuses : statuses.filter((s) => Number(s?.deviceId) === soDispositivo),
    );
  }

  /**
   * Telemetria do agente (tarefa 7): versão, SO, saúde por device e fila
   * offline pendente — enviada a cada ~60s (ver agent/src/core/telemetria.js).
   * Guarda a última foto no AgentBridgeService; o portal lê pelo
   * GET facial/agent/saude (FacialController, só para operador).
   *
   * `body` é `unknown` de propósito: rota `@Public()` (token do device, sem
   * JWT) e `@SkipThrottle()`, sob o limite padrão de body (2 MB, common/limite-corpo.ts) — não dá
   * pra confiar no formato. `setTelemetria()` sanitiza antes de guardar (ver
   * `sanitizarTelemetria()` em agent-bridge.service.ts).
   */
  @Public()
  @Post('condo/:token/telemetria')
  async condoTelemetria(@Param('token') token: string, @Body() body: unknown) {
    const { idCondominio, soDispositivo } = await this.escopo(token);
    // Telemetria é do agente do condomínio: token de um dispositivo não sobrescreve.
    if (soDispositivo == null) await this.bridge.setTelemetria(idCondominio, body);
    return { ok: true };
  }

  /**
   * Descoberta na rede (etapa 3): aparelhos achados na LAN pelo agente + MAC
   * dos cadastrados que estão online. `body` é `unknown` de propósito (rota
   * pública por token) — `DescobertaService.receber` sanitiza.
   */
  @Public()
  @Post('condo/:token/descobertos')
  async condoDescobertos(@Param('token') token: string, @Body() body: unknown) {
    const { idCondominio, soDispositivo } = await this.escopo(token);
    // Reescreve MAC/IP de qualquer aparelho do condomínio: só com o agent_token.
    if (soDispositivo != null) return { ok: true as const, ips_corrigidos: 0, macs_aprendidos: 0 };
    return this.descoberta.receber(idCondominio, body);
  }

  /**
   * Auto-atualização (tarefa 8): o agente consulta isto na partida e a cada
   * 6h (ver agent/src/core/atualizador.js) para saber se há uma versão mais
   * nova publicada. Token validado como as outras rotas condo/* (mesmo 401
   * de token inválido) — não expõe nada sensível, mas mantém o mesmo padrão
   * de autenticação de todo o resto deste controller.
   */
  @Public()
  @Get('condo/:token/versao')
  async condoVersao(@Param('token') token: string) {
    // Aceita os dois tokens: mantém a auto-atualização do agente antigo.
    await this.service.resolveAgente(token);
    return this.agentVersion.getLatest();
  }

  /**
   * agent_token → condomínio inteiro. webhook_token de um dispositivo (agente antigo) → só ele
   * (`soDispositivo`). Ver FacialService.resolveAgente.
   */
  private async escopo(token: string): Promise<{ idCondominio: number; soDispositivo: number | null }> {
    const a = await this.service.resolveAgente(token);
    return { idCondominio: a.idCondominio, soDispositivo: a.viaTokenDispositivo ? Number(a.idDispositivo) : null };
  }
}
