import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';

/**
 * Ações que o assistente propôs e aguardam confirmação do usuário no app.
 *
 * Por que duas fases: "reserva a churrasqueira sábado" é ambíguo — qual
 * sábado, qual churrasqueira, qual horário. Executar direto gera reserva
 * errada e ocorrência duplicada. O modelo PROPÕE, o app mostra os dados já
 * resolvidos, e só o toque do usuário executa.
 *
 * Guardado em estado_compartilhado (`acao-ia:<id>`, TTL 10 min): a API roda
 * em 2 instâncias e a confirmação pode cair na instância que não criou a
 * proposta. "Consumida" é marcada com UPDATE condicional — dois toques em
 * instâncias diferentes não executam duas vezes. Sem banco, memória.
 */

export type TipoAcao =
  | 'reserva_area'
  | 'ocorrencia'
  | 'visitante'
  | 'conta_morador'
  | 'mudanca'
  | 'comunicado'
  | 'manutencao_programada';

/** Linha do card. Genérico para o app renderizar sem saber o tipo. */
export interface ItemResumo {
  rotulo: string;
  valor: string;
}

/**
 * O que o botão faz no app. Só estes três efeitos, de propósito: com eles o
 * assistente alcança qualquer função do sistema sem precisar de um card novo
 * a cada feature.
 *
 *  copiar     → copia `valor` para a área de transferência (PIX, código)
 *  abrir_url  → abre `valor` no navegador (boleto, comprovante)
 *  abrir_tela → navega para uma tela do app (`valor` = chave da tela)
 */
export type EfeitoBotao = 'copiar' | 'abrir_url' | 'abrir_tela';

export interface BotaoCartao {
  rotulo: string;
  efeito: EfeitoBotao;
  valor: string;
}

/**
 * Card devolvido junto da resposta.
 *
 * `confirmavel` separa os dois mundos: true mostra Confirmar/Cancelar e exige
 * `id` (proposta guardada no store, executada por /chat-ia/confirmar); false é
 * um card informativo com atalhos, que não escreve nada.
 */
export interface CartaoAcao {
  id?: string;
  tipo: string;
  titulo: string;
  itens: ItemResumo[];
  confirmavel: boolean;
  botoes?: BotaoCartao[];
}

export interface AcaoPendente {
  id: string;
  tipo: TipoAcao;
  /** Dono da proposta — confirmada só por ele, conferido contra o JWT. */
  idUser: number;
  idCondominio: number;
  titulo: string;
  itens: ItemResumo[];
  /** Dados já validados e resolvidos que o executor vai usar. */
  payload: Record<string, any>;
  criadaEm: Date;
  expiraEm: Date;
  /** Marcada ao executar: impede que dois toques criem duas reservas. */
  consumidaEm?: Date;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutos
const PREFIXO = 'acao-ia:';

@Injectable()
export class AcaoPendenteStore {
  private readonly logger = new Logger(AcaoPendenteStore.name);
  private readonly estado: EstadoCompartilhado;

  constructor(@Optional() prisma?: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  async criar(dados: Omit<AcaoPendente, 'id' | 'criadaEm' | 'expiraEm'>): Promise<AcaoPendente> {
    const agora = new Date();
    const acao: AcaoPendente = {
      ...dados,
      id: 'acao_' + randomUUID().replace(/-/g, ''),
      criadaEm: agora,
      expiraEm: new Date(agora.getTime() + TTL_MS),
    };
    await this.estado.definir(PREFIXO + acao.id, acao, TTL_MS);
    return acao;
  }

  /**
   * Recupera uma proposta para confirmação.
   *
   * A posse é conferida aqui: id de proposta é palpável, e sem esta checagem
   * um usuário confirmaria a ação proposta para outro. Devolve motivo em vez
   * de boolean para o endpoint dar mensagem útil.
   */
  async obterParaConfirmar(
    id: string,
    idUser: number,
    idCondominio: number,
  ): Promise<{ acao?: AcaoPendente; erro?: string }> {
    const e = typeof id === 'string' && id ? await this.estado.obter<AcaoPendente>(PREFIXO + id) : null;
    if (!e) return { erro: 'Essa solicitação expirou. Peça novamente ao assistente.' };
    const acao: AcaoPendente = {
      ...e.valor,
      criadaEm: new Date(e.valor.criadaEm),
      expiraEm: new Date(e.valor.expiraEm),
      consumidaEm: e.consumidoEm ?? undefined,
    };
    if (acao.idUser !== idUser || acao.idCondominio !== idCondominio) {
      this.logger.warn(
        `tentativa de confirmar acao ${id} por user#${idUser}/cond#${idCondominio} (dona: user#${acao.idUser}/cond#${acao.idCondominio})`,
      );
      return { erro: 'Solicitação não encontrada.' };
    }
    if (acao.consumidaEm) return { erro: 'Essa solicitação já foi confirmada.' };
    return { acao };
  }

  /**
   * Marca como consumida ANTES de executar — dois toques não viram duas
   * reservas. Atômico no banco: com dois toques chegando em instâncias
   * diferentes, só um recebe true.
   */
  async marcarConsumida(id: string): Promise<boolean> {
    return this.estado.reivindicar(PREFIXO + id);
  }

  /** Devolve ao estado pendente se a execução falhar, para o usuário tentar de novo. */
  async liberar(id: string): Promise<void> {
    await this.estado.liberar(PREFIXO + id);
  }
}
