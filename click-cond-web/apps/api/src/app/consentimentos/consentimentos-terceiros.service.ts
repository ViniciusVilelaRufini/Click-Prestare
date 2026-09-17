import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { POLITICA_VERSAO } from './consentimentos.service';

export type TipoPessoaTerceiro = 'visitante' | 'prestador';

export interface AlvoTerceiro {
  idCondominio: number;
  tipoPessoa: TipoPessoaTerceiro;
  idPessoa: number;
  doc?: string | null;
}

export interface DeclaracaoTerceiro extends AlvoTerceiro {
  /** O titular autorizou o uso da biometria facial. */
  biometria: boolean;
  /** O titular declarou ser maior de 18 anos. */
  maiorIdade: boolean;
  /** Users.id de quem colheu; nulo para o porteiro, que não tem conta. */
  declaradoPorId?: number | null;
  declaradoPorNome?: string | null;
}

/**
 * Consentimento biométrico de quem NÃO tem conta no sistema.
 *
 * Morador e síndico passam pela tela de aceite do app e são cobertos por
 * `ConsentimentosService`. Visitante e prestador não passam por tela nenhuma:
 * quem cadastra é que declara ter colhido a autorização do titular, e sem essa
 * declaração o rosto não vai para o terminal.
 *
 * Tabela append-only, como a dos usuários: revogar é INSERT novo.
 */
@Injectable()
export class ConsentimentosTerceirosService {
  private readonly logger = new Logger(ConsentimentosTerceirosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Só dígitos. "123.456.789-00" e "12345678900" são a mesma pessoa. */
  static normalizarDoc(doc?: string | null): string | null {
    const limpo = (doc ?? '').replace(/\D/g, '');
    return limpo.length > 0 ? limpo : null;
  }

  /**
   * A declaração mais recente sobre este titular.
   *
   * Busca pelo DOCUMENTO quando há um: `Visitantes` grava uma linha por
   * visita, e a pessoa que volta na semana seguinte é a mesma pessoa — obrigá-la
   * a declarar de novo a cada entrada transformaria a caixa em ruído que o
   * porteiro marca no automático. Sem documento, cai no par (tipo, id).
   */
  private async ultima(alvo: AlvoTerceiro) {
    const doc = ConsentimentosTerceirosService.normalizarDoc(alvo.doc);

    const where = doc
      ? { id_condominio: alvo.idCondominio, doc }
      : {
          id_condominio: alvo.idCondominio,
          tipo_pessoa: alvo.tipoPessoa,
          id_pessoa: alvo.idPessoa,
        };

    return this.prisma.consentimentos_Terceiros.findFirst({
      where,
      orderBy: { registrado_em: 'desc' },
    });
  }

  /**
   * O titular autorizou o uso da biometria facial?
   *
   * Exige as DUAS coisas: autorização e maioridade declarada. São requisitos
   * independentes — o contrato veda biometria de menor de 18 ainda que o
   * responsável autorize, então uma não supre a outra.
   *
   * Responde `false` quando não há registro: ausência de consentimento não é
   * consentimento.
   */
  async autorizouBiometria(alvo: AlvoTerceiro): Promise<boolean> {
    if (!alvo?.idCondominio || !alvo?.idPessoa) return false;
    const ultima = await this.ultima(alvo);
    return ultima?.aceito === 1 && ultima?.maior_idade === 1;
  }

  /** Estado atual, para a tela mostrar o que já foi declarado. */
  async consultar(alvo: AlvoTerceiro) {
    const ultima = await this.ultima(alvo);
    return {
      declarado: !!ultima,
      biometria: ultima?.aceito === 1,
      maiorIdade: ultima?.maior_idade === 1,
      registrado_em: ultima?.registrado_em ?? null,
      declarado_por: ultima?.declarado_por_nome ?? null,
    };
  }

  /** Grava a declaração. Sempre INSERT — nunca UPDATE. */
  async registrar(dados: DeclaracaoTerceiro) {
    const doc = ConsentimentosTerceirosService.normalizarDoc(dados.doc);

    await this.prisma.consentimentos_Terceiros.create({
      data: {
        id_condominio: dados.idCondominio,
        tipo_pessoa: dados.tipoPessoa,
        id_pessoa: dados.idPessoa,
        doc,
        versao: POLITICA_VERSAO,
        aceito: dados.biometria ? 1 : 0,
        maior_idade: dados.maiorIdade ? 1 : 0,
        declarado_por_id: dados.declaradoPorId ?? null,
        declarado_por_nome: dados.declaradoPorNome ?? null,
        registrado_em: new Date(),
      },
    });

    this.logger.log(
      `Declaração de biometria (${dados.tipoPessoa} ${dados.idPessoa}, cond ${dados.idCondominio}): ` +
        `biometria=${dados.biometria}, maior_idade=${dados.maiorIdade}, por=${dados.declaradoPorNome ?? '-'}`,
    );

    return { ok: true, versao: POLITICA_VERSAO };
  }
}
