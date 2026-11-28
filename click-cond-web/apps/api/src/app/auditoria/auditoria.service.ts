import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext, normalizeIp } from '../common/context/request-context';
import { autorDoToken } from '../auth/usuario-do-token.util';
import {
  LIMITES_AUDITORIA,
  cortar,
  identidadeDoToken,
  nomeGenerico,
  redigirSegredos,
  serializarDetalhes,
} from '../common/auditoria-redacao.util';

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
  | 'EXPORT'            // exportação de dados (ex.: CSV do log de auditoria)
  // ---- Sessão do console da portaria ----
  | 'LOGIN'             // sessão do console emitida para um condomínio (detalhes.metodo: senha | mfa | qr | troca_condominio)
  | 'LOGIN_FALHA'       // conta existe, senha ou código de MFA errado (nunca grava a senha/código)
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
  | 'DISPOSITIVO_IP_CORRIGIDO'   // descoberta na rede achou o aparelho (mesmo MAC) em outro IP/porta
  | 'DISPOSITIVO_MAC_ATUALIZADO' // aparelho trocado fisicamente no mesmo endereço (MAC novo)
  // ---- Ciclo de vida comercial do condomínio (CRM) ----
  | 'DEACTIVATE'        // condomínio desligado: corta app, portaria e facial
  | 'REACTIVATE'        // condomínio religado antes da purga
  // ---- Interfone pelo app ----
  | 'INTERFONE_ABRIR'   // morador, porteiro ou operador da central abriu o portão durante a chamada do interfone
  | 'INTERFONE_CONFIG'; // síndico/CRM mudou a configuração do interfone (módulo, ramais, faciais, monitores)

/**
 * Em qual tabela `autor_id` vive (audit_logs.autor_tipo):
 *  - 'funcionario_portaria' → Funcionarios_Portaria.id (porteiro logado no console)
 *  - 'user'                 → Users.id (síndico, morador ou funcionário do app; síndico no console)
 *  - 'crm_admin'            → crm_admins.id (operador do CRM)
 *  - 'operador_central'     → Central_Operadores.id (operador da central de portaria)
 *  - 'sistema'              → job/automação; sem id
 */
export type AuditoriaAutorTipo = 'funcionario_portaria' | 'user' | 'crm_admin' | 'operador_central' | 'sistema';

export interface RegistrarAuditoriaDto {
  id_condominio: number;
  usuario_nome: string;
  usuario_email?: string;
  /** Id de quem fez a ação, na tabela indicada por `autor_tipo`. Ver `autorDoToken`. */
  autor_id?: number | null;
  autor_tipo?: AuditoriaAutorTipo | null;
  acao: AuditoriaAcao;
  modulo: string;
  entidade_id?: number;
  descricao: string;
  detalhes?: object;
  ip?: string;
  /**
   * `usuario_nome` é o nome de um APARELHO (terminal facial chamado "Portaria", por exemplo) e não
   * um rótulo genérico de autor: não troca pelo nome de quem está logado.
   */
  manterNome?: true;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma linha em audit_logs. Nunca lança: falha vira uma linha ERROR com o prefixo
   * `AUDITORIA_FALHA` (o alarme prestare-api-erros conta linhas ERROR), sem os detalhes.
   *
   * Autor: quando o chamador não informa `autor_id`/`autor_tipo`, vem do token da requisição em
   * curso (`requestContext` guarda uma referência fraca ao `req`; o passport preenche req.user depois). Fora de
   * requisição (job/tick) é 'sistema'. Rótulo genérico de nome ("Sistema / Portaria", ...) vira o
   * nome real de quem está logado.
   *
   * Detalhes: mesma redação e limite do AuditInterceptor (segredos omitidos, documento e telefone
   * mascarados, JSON válido de até 2000 caracteres). Campos de texto cortados no tamanho da coluna.
   */
  async registrar(data: RegistrarAuditoriaDto): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const rawIp = data.ip || ctx?.ip || null;
      const resolvedIp = rawIp ? normalizeIp(rawIp) : null;

      const user = ctx?.reqRef?.deref()?.user;
      const explicito = data.autor_id !== undefined || data.autor_tipo !== undefined;
      const autor = explicito
        ? { autor_id: data.autor_id ?? null, autor_tipo: data.autor_tipo ?? null }
        : autorDoToken(user);

      let usuarioNome = data.usuario_nome;
      let usuarioEmail = data.usuario_email;
      if (user && !data.manterNome) {
        const doToken = identidadeDoToken(user);
        if (doToken.nome && nomeGenerico(usuarioNome)) usuarioNome = doToken.nome;
        // E-mail do token só quando o nome gravado é o de quem está logado (nome específico de
        // outra pessoa, ex.: o visitante, não leva o e-mail do porteiro).
        if (!usuarioEmail && doToken.email && usuarioNome === doToken.nome) usuarioEmail = doToken.email;
      }

      await this.prisma.auditLog.create({
        data: {
          id_condominio: data.id_condominio,
          usuario_nome: cortar(usuarioNome || 'Sistema', LIMITES_AUDITORIA.usuario_nome) as string,
          usuario_email: cortar(usuarioEmail, LIMITES_AUDITORIA.usuario_email),
          autor_id: autor.autor_id,
          autor_tipo: autor.autor_tipo,
          acao: cortar(data.acao, LIMITES_AUDITORIA.acao) as string,
          modulo: cortar(data.modulo, LIMITES_AUDITORIA.modulo) as string,
          entidade_id: data.entidade_id ?? null,
          descricao: cortar(data.descricao ?? '', LIMITES_AUDITORIA.descricao) as string,
          detalhes: data.detalhes ? serializarDetalhes(redigirSegredos(data.detalhes)) : null,
          ip: cortar(resolvedIp || null, LIMITES_AUDITORIA.ip),
        },
      });
    } catch (e: any) {
      // Nunca bloquear o fluxo principal por falha de auditoria — mas alertar.
      this.logger.error(`AUDITORIA_FALHA modulo=${data?.modulo} acao=${data?.acao}: ${e?.message ?? e}`);
    }
  }
}
