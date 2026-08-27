import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditoriaAcao =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'ENTREGA'
  | 'RETIRADA'
  | 'RESPOSTA'
  | 'STATUS'
  // ---- Decisões de controle de acesso físico ----
  | 'ACCESS_GRANTED'    // identificação OK + regras OK → liberou
  | 'ACCESS_DENIED'     // credencial inválida, fora de janela, ou regra bloqueou
  | 'MANUAL_OVERRIDE'   // porteiro acionou trigger manual de uma abertura
  | 'BRIDGE_TRIGGER'    // ponte RFID/QR → botoeira disparou automático
  | 'RULE_CHANGE'       // CRUD em regras de acesso
  | 'DEVICE_CHANGE'     // CRUD em dispositivos (criar/desativar/trocar IP)
  | 'ONLINE'            // dispositivo voltou a responder na LAN (heartbeat do agente)
  | 'OFFLINE'           // dispositivo parou de responder na LAN
  | 'FANTASMAS_REMOVIDOS' // tickFantasmas removeu biometria órfã de um terminal
  // ---- Ciclo de vida comercial do condomínio (CRM) ----
  | 'DEACTIVATE'        // condomínio desligado: corta app, portaria e facial
  | 'REACTIVATE';       // condomínio religado antes da purga

export interface RegistrarAuditoriaDto {
  id_condominio: number;
  usuario_nome: string;
  usuario_email?: string;
  acao: AuditoriaAcao;
  modulo: string;
  entidade_id?: number;
  descricao: string;
  detalhes?: object;
  ip?: string;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(data: RegistrarAuditoriaDto): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id_condominio: data.id_condominio,
          usuario_nome: data.usuario_nome,
          usuario_email: data.usuario_email ?? null,
          acao: data.acao,
          modulo: data.modulo,
          entidade_id: data.entidade_id ?? null,
          descricao: data.descricao,
          detalhes: data.detalhes ? JSON.stringify(data.detalhes) : null,
          ip: data.ip ?? null,
        },
      });
    } catch (e) {
      // Nunca bloquear o fluxo principal por falha de auditoria
      console.error('[AuditoriaService] Erro ao registrar log:', e);
    }
  }
}
