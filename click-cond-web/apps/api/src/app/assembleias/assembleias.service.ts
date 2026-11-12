import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../prisma/generated';
import { type Gravados, StorageService, umaVez } from '../common/storage/storage.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { hojeBrasilia } from '../common/hora-brasilia.util';
import { rotuloBloco } from '../common/rotulo-bloco.util';

/** Título da assembleia sem espaços nas pontas; vazio é erro (não grava sem nome). */
function tituloObrigatorio(valor: unknown): string {
  const titulo = String(valor ?? '').trim();
  if (!titulo) throw new BadRequestException('Título é obrigatório.');
  return titulo;
}

/** Unidade do usuário no condomínio, para votar e mostrar o voto dela. */
export type UnidadeVoto = { id_apto: number; rotulo: string };

/** Voto que vale hoje numa unidade do usuário (`opcao` nulo: a unidade não votou). */
export type VotoDaUnidade = { id_votacao: number; id_apto: number; rotulo: string; opcao: string | null };

/** Voto apurado de uma unidade: o mais recente dela. */
type VotoApurado = { id: number; id_opcao: number; t: number };

@Injectable()
export class AssembleiasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantAccessService,
  ) {}

  /**
   * `gravados`: anexos que a assembleia já tem. URL do bucket que não é um
   * deles é recusada (StorageService.exigirArquivoDoRegistro) — a API assina
   * toda URL do bucket que devolve.
   */
  private async uploadDocs(docs: unknown, prefix: string, gravados: Gravados): Promise<string[]> {
    if (!Array.isArray(docs)) return [];
    const atuais = typeof gravados === 'function' ? umaVez(async () => gravados()) : gravados;
    // `anexos` é gravado com join(';'): um doc "externo;URL do bucket" passaria
    // inteiro (host externo) e viraria dois anexos — cada parte é conferida.
    // Data URL também: se o upload falha, o storage devolve a própria data
    // URL, e "data:...;<URL do bucket>" seria gravada como veio.
    for (const doc of docs) {
      const partes: unknown[] = typeof doc === 'string' ? doc.split(';') : [doc];
      for (const parte of partes) {
        await this.storage.exigirArquivoDoRegistro(typeof parte === 'string' ? parte.trim() : parte, atuais);
      }
    }
    const out: string[] = [];
    for (const doc of docs) {
      if (typeof doc !== 'string') continue;
      if (this.storage.isDataUrl(doc)) {
        const url = await this.storage.uploadDataUrl(doc, prefix);
        if (url) out.push(url);
      } else if (doc.trim()) {
        out.push(doc);
      }
    }
    return out;
  }

  /**
   * Anexos já gravados na assembleia (coluna `anexos`, separados por ';').
   * Só conta como "gravado" o arquivo do bucket que está na pasta onde este
   * serviço sobe anexo (`assembleias/`): um valor contaminado antes da trava
   * do ';' (URL de outra pasta entrando como parte) não vira "da assembleia".
   */
  private async anexosGravados(idAssembleia: number, idCondominio: number): Promise<string[]> {
    const atual = await this.prisma.assembleias.findFirst({
      where: { id: idAssembleia, id_condominio: idCondominio },
      select: { anexos: true },
    });
    return (atual?.anexos ?? '')
      .split(';')
      .map((parte) => parte.trim())
      .filter((parte) => (this.storage.chaveDoArquivo(parte) ?? '').startsWith('assembleias/'));
  }

  // ==========================================
  // ASSEMBLEIAS
  // ==========================================
  async insert(idCondominio: number, assembleia: any, userId: number, requester?: JwtPayload) {
    assertStaff(requester, 'criar assembleia');
    await this.tenant.assertCondominio(idCondominio, requester);
    assembleia.titulo = tituloObrigatorio(assembleia.titulo);
    if (!this.prisma.isConnected) return { success: true };

    // Processar anexos (docs) — upload real para R2 quando vierem em base64.
    // Assembleia nova não tem anexo gravado.
    const listDocs = await this.uploadDocs(assembleia.docs, 'assembleias', []);

    // Datas no formato YYYY-MM-DD ou DD/MM/YYYY
    let dataObj: Date | undefined;
    if (assembleia.data) {
      if (assembleia.data.includes('/')) {
        const parts = assembleia.data.split('/');
        dataObj = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        dataObj = new Date(assembleia.data);
      }
    }

    let horaObj: Date | undefined;
    if (assembleia.hora) {
      const match = String(assembleia.hora).match(/(\d{2}):(\d{2})/);
      if (match) {
        const h = Number(match[1]);
        const m = Number(match[2]);
        horaObj = new Date(1970, 0, 1, h, m, 0);
      }
    }

    // Verificar se o usuário existe para evitar erro de FK (especialmente em ambiente local onde o ID 1 pode não existir)
    let finalUserId: number | undefined = undefined;
    if (userId) {
      const userExists = await this.prisma.users.findUnique({ where: { id: Number(userId) } });
      if (userExists) {
        finalUserId = userExists.id;
      }
    }

    await this.prisma.assembleias.create({
      data: {
        titulo: assembleia.titulo,
        descricao: assembleia.descricao,
        data: dataObj,
        hora: horaObj,
        local: assembleia.local,
        link: assembleia.link ?? '',
        id_condominio: Number(idCondominio),
        user: finalUserId,
        anexos: listDocs.join(';'),
      },
    });

    return { success: true };
  }

  async update(idCondominio: number, assembleia: any, userId: number, requester?: JwtPayload) {
    assertStaff(requester, 'editar assembleia');
    await this.tenant.assertCondominio(idCondominio, requester);
    if (assembleia.titulo !== undefined) assembleia.titulo = tituloObrigatorio(assembleia.titulo);
    if (!this.prisma.isConnected) return { success: true };

    const listDocs = await this.uploadDocs(assembleia.docs, 'assembleias', () =>
      this.anexosGravados(Number(assembleia.id), Number(idCondominio)),
    );

    let dataObj: Date | undefined;
    if (assembleia.data) {
      if (assembleia.data.includes('/')) {
        const parts = assembleia.data.split('/');
        dataObj = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        dataObj = new Date(assembleia.data);
      }
    }

    let horaObj: Date | undefined;
    if (assembleia.hora) {
      const match = String(assembleia.hora).match(/(\d{2}):(\d{2})/);
      if (match) {
        const h = Number(match[1]);
        const m = Number(match[2]);
        horaObj = new Date(1970, 0, 1, h, m, 0);
      }
    }

    // Verificar se o usuário existe para evitar erro de FK
    let finalUserId: number | undefined = undefined;
    if (userId) {
      const userExists = await this.prisma.users.findUnique({ where: { id: Number(userId) } });
      if (userExists) {
        finalUserId = userExists.id;
      }
    }

    await this.prisma.assembleias.updateMany({
      where: {
        id: Number(assembleia.id),
        id_condominio: Number(idCondominio),
      },
      data: {
        titulo: assembleia.titulo,
        descricao: assembleia.descricao,
        ...(dataObj ? { data: dataObj } : {}),
        ...(horaObj ? { hora: horaObj } : {}),
        local: assembleia.local,
        link: assembleia.link ?? '',
        user: finalUserId,
        ...(listDocs.length > 0 ? { anexos: listDocs.join(';') } : {}),
      },
    });

    return { success: true };
  }

  async remove(id: number, requester?: JwtPayload) {
    assertStaff(requester, 'remover assembleia');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.assembleias.findUnique({ where: { id: Number(id) }, select: { id_condominio: true } });
    if (!atual) throw new NotFoundException('Assembleia não encontrada');
    await this.tenant.assertEntidade(atual.id_condominio, requester, `assembleia #${id}`);
    await this.prisma.assembleias.delete({ where: { id: Number(id) } });
    return { success: true };
  }

  async getAll(idCondominio: number, requester?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, requester);
    if (!this.prisma.isConnected) {
      return [
        { id: 1, titulo: 'Assembleia Geral Ordinária', descricao: 'Aprovação de contas e eleição de síndico', data: '20/05/2026', hora: '19:30' },
      ];
    }

    const list = await this.prisma.assembleias.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: { data: 'asc' },
    });

    return list.map(item => ({
      id: item.id,
      titulo: item.titulo,
      descricao: item.descricao,
      data: item.data ? item.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      hora: item.hora ? item.hora.toTimeString().substring(0, 5) : '',
    }));
  }

  async get(idCondominio: number, idAssembleia: number, userId: number, requester?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, requester);
    if (!this.prisma.isConnected) {
      return {
        assembleia: {
          id: idAssembleia, titulo: 'Assembleia Geral Ordinária', descricao: 'Aprovação de contas',
          data: '20/05/2026', hora: '19:30', link: 'https://meet.google.com', local: 'Salão de Festas', anexos: '',
        },
        votacoes: [],
        meusVotos: [],
        unidades: [],
        votosPorUnidade: [],
      };
    }

    const item = await this.prisma.assembleias.findFirst({
      where: { id: Number(idAssembleia), id_condominio: Number(idCondominio) },
    });

    if (!item) throw new NotFoundException('Assembleia não encontrada');

    const assembleiaFormatada = {
      id: item.id,
      titulo: item.titulo,
      descricao: item.descricao,
      data: item.data ? item.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      hora: item.hora ? item.hora.toTimeString().substring(0, 5) : '',
      link: item.link ?? '',
      local: item.local ?? '',
      anexos: item.anexos ?? '',
    };

    // Buscar votações da assembleia
    const { formatadas: votacoes, apuracao } = await this.consultarVotacoes(
      Number(idAssembleia), false, Number(idCondominio),
    );
    // Campo antigo (app até 1.2.41): opções em que a própria conta votou.
    const meusVotos = await this.getMyVotosAssembleia(Number(idAssembleia), Number(userId));
    // Novo: as unidades do usuário e o voto que vale em cada uma.
    const unidades = await this.unidadesDoUsuario(Number(idCondominio), Number(userId));

    return {
      assembleia: assembleiaFormatada,
      votacoes,
      meusVotos,
      unidades,
      votosPorUnidade: this.votosPorUnidade(votacoes.map((v) => v.id), unidades, apuracao),
    };
  }

  async finish(idCondominio: number, assembleia: any, requester?: JwtPayload) {
    assertStaff(requester, 'finalizar assembleia');
    await this.tenant.assertCondominio(idCondominio, requester);
    if (!this.prisma.isConnected) return { success: true };

    // Confirma que a assembleia a ser apagada pertence mesmo a este
    // condomínio — sem isso, um síndico de outro condomínio (que já passou
    // no assertCondominio acima para o SEU idCondominio) conseguia apagar
    // a assembleia de qualquer outro só chutando o id.
    const alvo = await this.prisma.assembleias.findUnique({
      where: { id: Number(assembleia.id) },
      select: { id_condominio: true },
    });
    if (!alvo) throw new NotFoundException('Assembleia não encontrada');
    await this.tenant.assertEntidade(alvo.id_condominio, requester, `assembleia #${assembleia.id}`);

    // A ATA pode ser um dos anexos da própria assembleia; outra URL do bucket, não.
    await this.storage.exigirArquivoDoRegistro(assembleia.doc, () =>
      this.anexosGravados(Number(assembleia.id), Number(idCondominio)),
    );
    let linkDoc = '';
    if (this.storage.isDataUrl(assembleia.doc)) {
      linkDoc = (await this.storage.uploadDataUrl(assembleia.doc, 'atas')) ?? '';
    } else {
      linkDoc = assembleia.doc ?? '';
    }

    const nomeAta = `ATA ${assembleia.titulo} - ${assembleia.data}`;

    // Gravar na tabela Documentos
    await this.prisma.documentos.create({
      data: {
        id_condominio: Number(idCondominio),
        is_ata: 1,
        nome: nomeAta,
        link_doc: linkDoc,
      },
    });

    // Remover assembleia finalizada
    await this.prisma.assembleias.delete({
      where: { id: Number(assembleia.id) },
    });

    return {
      message: 'Assembléia Finalizada!\nA ATA se encontra disponível no menu "Docs" na tela de seu condomínio.',
    };
  }

  // ==========================================
  // VOTAÇÕES E ENQUETES
  // ==========================================
  async insertVotacao(votacao: any, idCondominio: number, requester?: JwtPayload) {
    assertStaff(requester, 'criar votação/enquete');
    await this.tenant.assertCondominio(idCondominio, requester);
    if (!this.prisma.isConnected) return { success: true };

    const titulo = String(votacao?.titulo ?? '').trim();
    if (!titulo) throw new BadRequestException(
      votacao?.is_enquete ? 'Informe o título da enquete.' : 'Informe o título da votação.',
    );

    // Opções: trim, sem vazias e sem repetidas (maiúsculas não diferenciam).
    const vistas = new Set<string>();
    const opcoes: string[] = [];
    for (const o of Array.isArray(votacao.opcoes) ? votacao.opcoes : []) {
      const nome = String(o ?? '').trim();
      if (!nome || vistas.has(nome.toLowerCase())) continue;
      vistas.add(nome.toLowerCase());
      opcoes.push(nome);
    }
    if (opcoes.length < 2) throw new BadRequestException('Informe pelo menos duas opções diferentes.');

    if (!String(votacao.data_inicio ?? '').trim() || !String(votacao.data_termino ?? '').trim()) {
      throw new BadRequestException('Informe as datas de início e término.');
    }
    const parseDate = (dStr: string) => {
      if (dStr.includes('/')) {
        const p = dStr.split('/');
        return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
      }
      return new Date(dStr);
    };

    const dIni = parseDate(String(votacao.data_inicio).trim());
    const dFim = parseDate(String(votacao.data_termino).trim());
    if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime())) {
      throw new BadRequestException('Datas da votação inválidas.');
    }
    if (dFim < dIni) {
      throw new BadRequestException('A data de término não pode ser anterior à data de início.');
    }
    const isEnquete = votacao.is_enquete ? 1 : 0;

    const idAssembleia = votacao.id_assembleia ? Number(votacao.id_assembleia) : null;
    if (idAssembleia) {
      const assembleia = await this.prisma.assembleias.findFirst({
        where: { id: idAssembleia, id_condominio: Number(idCondominio) },
        select: { id: true },
      });
      if (!assembleia) throw new BadRequestException('Assembleia não encontrada neste condomínio.');
    }

    // Votação e opções juntas: sem votação órfã sem opções.
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.votacoes.create({
        data: {
          titulo,
          descricao: votacao.descricao ?? '',
          data_inicio: dIni,
          data_termino: dFim,
          id_assembleia: idAssembleia,
          id_condominio: Number(idCondominio),
          is_enquete: isEnquete,
        },
      });
      await tx.votacoes_Opcoes.createMany({
        data: opcoes.map((nome) => ({ id_votacao: created.id, nome })),
      });
    });

    return { success: true };
  }

  async removeVotacao(id: number, requester?: JwtPayload) {
    assertStaff(requester, 'remover votação/enquete');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.votacoes.findUnique({ where: { id: Number(id) }, select: { id_condominio: true } });
    if (!atual) throw new NotFoundException('Votação não encontrada');
    await this.tenant.assertEntidade(atual.id_condominio, requester, `votação #${id}`);
    await this.prisma.votacoes.delete({ where: { id: Number(id) } });
    return { success: true };
  }

  async finishVotacao(id: number, requester?: JwtPayload) {
    assertStaff(requester, 'encerrar votação/enquete');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.votacoes.findUnique({ where: { id: Number(id) }, select: { id_condominio: true } });
    if (!atual) throw new NotFoundException('Votação não encontrada');
    await this.tenant.assertEntidade(atual.id_condominio, requester, `votação #${id}`);

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    await this.prisma.votacoes.update({
      where: { id: Number(id) },
      data: { data_termino: ontem },
    });

    return { success: true };
  }

  /**
   * Um voto por UNIDADE (votação × apartamento), de quem tem vínculo
   * (`Apartamentos_Users`, qualquer tipo) com a unidade, no condomínio da
   * votação. O voto grava a unidade em `id_apto` — antes não gravava, e quem
   * tinha duas unidades votava só pela de menor `id_apto`.
   *
   * Qual unidade:
   *  - `idApto` informado (app novo): tem de ser uma unidade do usuário neste
   *    condomínio, senão 403;
   *  - sem `idApto` (app antigo): a única unidade, ou a de menor `id_apto`
   *    quando há várias — a mesma "unidade atribuída" de antes, para o app
   *    antigo continuar votando como votava.
   *
   * O voto novo substitui o da MESMA unidade: os votos com `id_apto = U` e os
   * antigos (`id_apto` nulo, anteriores à coluna) das contas cuja unidade
   * atribuída é U. Nunca o de outra unidade. A transação trava a linha do
   * apartamento (FOR UPDATE) para que dois votos simultâneos da unidade não
   * gravem duas linhas; se ainda sobrar duplicata (não há índice único — a
   * coluna tem nulos antigos), a apuração fica com a mais recente.
   */
  async registerVoto(votacaoId: number, opcaoId: number, userId: number, requester?: JwtPayload, idApto?: number) {
    if (!this.prisma.isConnected) return { success: true };

    const votacao = await this.prisma.votacoes.findUnique({
      where: { id: Number(votacaoId) },
      include: { opcoes: { select: { id: true } } },
    });
    if (!votacao) throw new NotFoundException('Votação não encontrada');
    await this.tenant.assertEntidade(votacao.id_condominio, requester, `votação #${votacaoId}`);

    const status = this.calcStatusInt(votacao.data_inicio, votacao.data_termino);
    if (status === 0) throw new BadRequestException('Votação ainda não foi iniciada');
    if (status === 2) throw new BadRequestException('Votação já foi finalizada');

    const idsOpcoes = votacao.opcoes.map(o => o.id);
    if (!idsOpcoes.includes(Number(opcaoId))) {
      throw new BadRequestException('Opção inválida para esta votação');
    }

    if (idApto != null && !(Number.isInteger(idApto) && idApto > 0)) {
      throw new BadRequestException('Unidade inválida.');
    }

    const minhasUnidades = await this.unidadesDoUsuario(votacao.id_condominio, Number(userId));
    if (minhasUnidades.length === 0) {
      throw new ForbiddenException('Somente moradores com unidade no condomínio podem votar.');
    }
    let unidade: number;
    if (idApto != null) {
      if (!minhasUnidades.some((u) => u.id_apto === idApto)) {
        throw new ForbiddenException('Você não tem vínculo com esta unidade.');
      }
      unidade = idApto;
    } else {
      // App antigo: a menor id_apto (a lista vem ordenada).
      unidade = minhasUnidades[0].id_apto;
    }

    // Votos antigos (sem id_apto) contam pela unidade atribuída da conta: os
    // que caem em U são os das contas do apto cuja menor unidade é U.
    const contasDoApto = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: unidade },
      select: { id_user: true },
    });
    const candidatos = [...new Set([Number(userId), ...contasDoApto.map((v) => v.id_user)])];
    const atribuidas = await this.unidadesAtribuidas(votacao.id_condominio, candidatos);
    const antigosDe = candidatos.filter((id) => atribuidas.get(id) === unidade);

    // READ COMMITTED: em REPEATABLE READ o DELETE que não acha linhas deixa
    // gap lock no idx_vu_apto_opcao, e duas unidades DIFERENTES votando pela
    // primeira vez ao mesmo tempo podiam dar deadlock. A mesma unidade segue
    // serializada pelo FOR UPDATE. Deadlock residual (P2034): refaz até 2 vezes.
    for (let tentativa = 0; ; tentativa++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // Serializa os votos da unidade: o segundo espera o primeiro
            // confirmar e então apaga a linha que ele gravou.
            await tx.$queryRaw`SELECT id FROM Apartamentos WHERE id = ${unidade} FOR UPDATE`;
            await tx.votacoes_Usuarios.deleteMany({
              where: {
                id_opcao: { in: idsOpcoes },
                OR: [{ id_apto: unidade }, { id_apto: null, id_user: { in: antigosDe } }],
              },
            });
            await tx.votacoes_Usuarios.create({
              data: {
                id_opcao: Number(opcaoId),
                id_user: Number(userId),
                id_apto: unidade,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        break;
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2034' || tentativa >= AssembleiasService.NOVAS_TENTATIVAS_VOTO) throw e;
      }
    }

    return { success: true };
  }

  /** Quantas vezes o voto é refeito depois de um deadlock (P2034). */
  private static readonly NOVAS_TENTATIVAS_VOTO = 2;

  async enqueteGetAll(idCondominio: number, requester?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, requester);
    if (!this.prisma.isConnected) {
      return [
        {
          id: 1, titulo: 'Melhoria da Academia', descricao: 'Qual equipamento comprar?',
          data_inicio: '10/05/2026', data_termino: '30/05/2026', status: 1,
          opcoes: ['1;Esteira;5', '2;Bicicleta;3'],
        },
      ];
    }

    return this.getVotacoesFormatadas(undefined, true, Number(idCondominio));
  }

  async enqueteGetDetails(idVotacao: number, userId: number, requester?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return {
        votacao: {
          id: idVotacao, titulo: 'Melhoria da Academia', descricao: 'Qual equipamento comprar?',
          data_inicio: '10/05/2026', data_termino: '30/05/2026', status: 1,
          opcoes: ['1;Esteira;5', '2;Bicicleta;3'],
        },
        meuVoto: ['1'],
        unidades: [],
        votosPorUnidade: [],
      };
    }

    const raw = await this.prisma.votacoes.findUnique({
      where: { id: Number(idVotacao) },
      select: { id_condominio: true },
    });
    if (!raw) throw new NotFoundException('Enquete não encontrada');
    await this.tenant.assertEntidade(raw.id_condominio, requester, `enquete #${idVotacao}`);

    const { formatadas: list, apuracao } = await this.consultarVotacoes(undefined, true, undefined, Number(idVotacao));
    const votacao = list[0];

    if (!votacao) throw new NotFoundException('Enquete não encontrada');

    // Buscar voto do usuário
    const vu = await this.prisma.votacoes_Usuarios.findFirst({
      where: {
        id_user: Number(userId),
        opcao: { id_votacao: Number(idVotacao) },
      },
      select: { id_opcao: true },
      // Mesmo critério da apuração: vale o voto mais recente.
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    // Campo antigo (app até 1.2.41): o voto mais recente da própria conta.
    const meuVoto = vu ? [String(vu.id_opcao)] : [];
    // Novo: as unidades do usuário e o voto que vale em cada uma.
    const unidades = await this.unidadesDoUsuario(raw.id_condominio, Number(userId));

    return { votacao, meuVoto, unidades, votosPorUnidade: this.votosPorUnidade([votacao.id], unidades, apuracao) };
  }

  // ==========================================
  // FUNÇÕES DE FORMATACÃO E CÁLCULO
  // ==========================================
  private async getVotacoesFormatadas(
    idAssembleia?: number,
    isEnquete: boolean = false,
    idCondominio?: number,
    idVotacaoEspecifica?: number,
  ) {
    return (await this.consultarVotacoes(idAssembleia, isEnquete, idCondominio, idVotacaoEspecifica)).formatadas;
  }

  /**
   * Votações no formato da API mais a apuração por unidade
   * (`apuracao.get(idVotacao).get(idApto)` = voto que vale na unidade).
   */
  private async consultarVotacoes(
    idAssembleia?: number,
    isEnquete: boolean = false,
    idCondominio?: number,
    idVotacaoEspecifica?: number,
  ) {
    const whereClause: any = {};
    if (idAssembleia !== undefined) whereClause.id_assembleia = idAssembleia;
    if (isEnquete) whereClause.is_enquete = 1;
    if (idCondominio !== undefined) whereClause.id_condominio = idCondominio;
    if (idVotacaoEspecifica !== undefined) whereClause.id = idVotacaoEspecifica;

    const votacoesDb = await this.prisma.votacoes.findMany({
      where: whereClause,
      include: {
        opcoes: {
          include: {
            votos: { select: { id: true, id_user: true, id_apto: true, created_at: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Vínculos de cada votante, por condomínio (uma consulta cada).
    const vinculosPorCond = new Map<number, Map<number, number[]>>();
    for (const idCond of new Set(votacoesDb.map((v) => v.id_condominio))) {
      const votantes = votacoesDb
        .filter((v) => v.id_condominio === idCond)
        .flatMap((v) => v.opcoes.flatMap((op) => op.votos.map((voto) => voto.id_user)));
      vinculosPorCond.set(idCond, await this.vinculosNoCondominio(idCond, [...new Set(votantes)]));
    }

    const apuracao = new Map<number, Map<number, VotoApurado>>();
    const formatadas = votacoesDb.map(v => {
      // Um voto por UNIDADE (ver registerVoto): vale o mais recente. A unidade
      // é a gravada no voto (`id_apto`) ou, no voto antigo sem ela, a
      // atribuída da conta (menor id_apto). Sem índice único, dois votos
      // simultâneos da unidade podem gravar duas linhas; aqui contam uma.
      // Votante sem vínculo com a unidade (ou sem unidade no condomínio) não conta.
      const vinculosDe = vinculosPorCond.get(v.id_condominio) ?? new Map<number, number[]>();
      const ultimoVoto = new Map<number, VotoApurado>();
      for (const op of v.opcoes) {
        for (const voto of op.votos) {
          const unidade = this.unidadeDoVoto(voto.id_apto, vinculosDe.get(voto.id_user));
          if (unidade == null) continue;
          const t = new Date(voto.created_at).getTime();
          const atual = ultimoVoto.get(unidade);
          if (!atual || t > atual.t || (t === atual.t && voto.id > atual.id)) {
            ultimoVoto.set(unidade, { id: voto.id, id_opcao: op.id, t });
          }
        }
      }
      apuracao.set(v.id, ultimoVoto);
      const votosPorOpcao = new Map<number, number>();
      for (const { id_opcao } of ultimoVoto.values()) {
        votosPorOpcao.set(id_opcao, (votosPorOpcao.get(id_opcao) ?? 0) + 1);
      }

      const dIniStr = v.data_inicio ? v.data_inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const dFimStr = v.data_termino ? v.data_termino.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

      // Computar o status como inteiro (0 = agendado, 1 = em andamento, 2 = finalizado)
      const statusInt = this.calcStatusInt(v.data_inicio, v.data_termino);

      // Mapear opções para o formato de string do group_concat: "id;nome;votos"
      const opcoesStrArray = v.opcoes.map(op => `${op.id};${op.nome};${votosPorOpcao.get(op.id) ?? 0}`);

      return {
        id: v.id,
        titulo: v.titulo,
        descricao: v.descricao ?? '',
        data_inicio: dIniStr,
        data_termino: dFimStr,
        status: statusInt,
        opcoes: opcoesStrArray,
      };
    });
    return { formatadas, apuracao };
  }

  /**
   * Unidade em que um voto conta: a gravada (`id_apto`), se o votante ainda
   * tem vínculo com ela; no voto antigo (nulo), a menor unidade do votante.
   * `vinculos` vem ordenado (ver vinculosNoCondominio).
   */
  private unidadeDoVoto(idApto: number | null | undefined, vinculos: number[] | undefined): number | undefined {
    if (!vinculos || vinculos.length === 0) return undefined;
    if (idApto != null) return vinculos.includes(idApto) ? idApto : undefined;
    return vinculos[0];
  }

  /** Para cada votação × unidade do usuário, a opção que vale nela (ou nulo). */
  private votosPorUnidade(
    idsVotacoes: number[],
    unidades: UnidadeVoto[],
    apuracao: Map<number, Map<number, VotoApurado>>,
  ): VotoDaUnidade[] {
    return idsVotacoes.flatMap((idVotacao) =>
      unidades.map((u) => {
        const voto = apuracao.get(idVotacao)?.get(u.id_apto);
        return { id_votacao: idVotacao, id_apto: u.id_apto, rotulo: u.rotulo, opcao: voto ? String(voto.id_opcao) : null };
      }),
    );
  }

  /**
   * Unidades do usuário no condomínio (vínculo em `Apartamentos_Users`, sem
   * repetir), em ordem de `id_apto` — a primeira é a unidade atribuída. Serve
   * ao voto (qual unidade) e ao app (escolher a unidade e mostrar o voto dela).
   */
  private async unidadesDoUsuario(idCondominio: number, userId: number): Promise<UnidadeVoto[]> {
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: Number(userId), apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_apto: true, apartamento: { select: { bloco: true, apto: true } } },
    });
    const porApto = new Map<number, UnidadeVoto>();
    for (const { id_apto, apartamento } of vinculos) {
      if (porApto.has(id_apto)) continue;
      const apto = (apartamento?.apto ?? '').trim();
      const bloco = rotuloBloco(apartamento?.bloco);
      const rotulo = apto ? (bloco ? `Apto ${apto} ${bloco}` : `Apto ${apto}`) : bloco || `Unidade ${id_apto}`;
      porApto.set(id_apto, { id_apto, rotulo });
    }
    return [...porApto.values()].sort((a, b) => a.id_apto - b.id_apto);
  }

  /**
   * Unidades de cada conta no condomínio (`Apartamentos_Users`), em ordem de
   * `id_apto`. Conta sem vínculo no condomínio fica fora do mapa.
   */
  private async vinculosNoCondominio(idCondominio: number, idsUsuarios: number[]): Promise<Map<number, number[]>> {
    const porUsuario = new Map<number, number[]>();
    if (idsUsuarios.length === 0) return porUsuario;
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: { in: idsUsuarios }, apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_user: true, id_apto: true },
    });
    for (const { id_user, id_apto } of vinculos) {
      const lista = porUsuario.get(id_user) ?? [];
      if (!lista.includes(id_apto)) lista.push(id_apto);
      porUsuario.set(id_user, lista);
    }
    for (const lista of porUsuario.values()) lista.sort((a, b) => a - b);
    return porUsuario;
  }

  /**
   * Unidade atribuída de cada conta no condomínio: o menor `id_apto` entre os
   * vínculos dela. É por ela que conta o voto antigo, gravado sem `id_apto`,
   * e é a unidade do voto do app antigo (que não manda `id_apto`).
   */
  private async unidadesAtribuidas(idCondominio: number, idsUsuarios: number[]): Promise<Map<number, number>> {
    const unidade = new Map<number, number>();
    for (const [idUser, aptos] of await this.vinculosNoCondominio(idCondominio, idsUsuarios)) {
      unidade.set(idUser, aptos[0]);
    }
    return unidade;
  }

  private async getMyVotosAssembleia(idAssembleia: number, userId: number): Promise<string[]> {
    const votosDb = await this.prisma.votacoes_Usuarios.findMany({
      where: {
        id_user: Number(userId),
        opcao: {
          votacao: { id_assembleia: Number(idAssembleia) },
        },
      },
      select: { id_opcao: true },
    });

    return votosDb.map(v => String(v.id_opcao));
  }

  private calcStatusInt(dIni?: Date | null, dFim?: Date | null): number {
    if (!dIni || !dFim) return 1;

    // As datas são @db.Date (meia-noite UTC). "Hoje" precisa ser o dia de
    // Brasília no mesmo formato: com a data UTC do servidor, a votação fechava
    // às 21h do último dia e abria às 21h da véspera.
    const hoje = hojeBrasilia();
    const diaUtc = (d: Date) => {
      const x = new Date(d);
      return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
    };
    const inicio = diaUtc(dIni);
    const fim = diaUtc(dFim);

    if (fim < hoje) return 2; // finalizado
    if (inicio > hoje) return 0; // agendado
    return 1; // em andamento
  }
}
