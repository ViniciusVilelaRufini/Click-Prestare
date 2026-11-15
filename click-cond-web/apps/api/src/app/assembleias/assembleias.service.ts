import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../prisma/generated';
import { type Gravados, StorageService, umaVez } from '../common/storage/storage.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { formatarDataHoraBrasilia, hojeBrasilia } from '../common/hora-brasilia.util';
import { rotuloBloco } from '../common/rotulo-bloco.util';
import { NotificationsService } from '../notifications/notifications.service';
import { avisarMoradoresDoCondominio } from '../comunicados/avisar-moradores.util';
import { maiorVinculo, nivelVinculo, normalizarTipoVinculo, type TipoVinculo } from '../common/tipo-vinculo.util';

/** Título da assembleia sem espaços nas pontas; vazio é erro (não grava sem nome). */
function tituloObrigatorio(valor: unknown): string {
  const titulo = String(valor ?? '').trim();
  if (!titulo) throw new BadRequestException('Título é obrigatório.');
  return titulo;
}

/**
 * Data da assembleia em DD/MM/AAAA (meia-noite local, como antes) ou
 * AAAA-MM-DD, com hora opcional depois (`[ T]HH:mm[:ss[.sss]][Z]`), da qual só
 * vale a data, em meia-noite UTC. O app do síndico manda o `toString()` de um
 * DateTime do Dart, "2026-11-20 00:00:00.000" (convertStringToDate em
 * utils.dart); com o servidor em UTC, `new Date(...)` dava o mesmo valor.
 * Vazio: sem data. Fora do padrão ou dia inexistente ("20/11", "20-11-2026",
 * "32/11/2026", "2026-02-30"): 400 — antes virava Invalid Date (ou rolava
 * para outro mês) e o Prisma dava 500.
 */
function dataDaAssembleia(valor: unknown): Date | undefined {
  const s = String(valor ?? '').trim();
  if (!s) return undefined;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?$/);
  const [ano, mes, dia] = br
    ? [Number(br[3]), Number(br[2]), Number(br[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [NaN, NaN, NaN];
  const ref = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    Number.isNaN(ref.getTime()) ||
    ref.getUTCFullYear() !== ano || ref.getUTCMonth() !== mes - 1 || ref.getUTCDate() !== dia
  ) {
    throw new BadRequestException('Data inválida: use DD/MM/AAAA.');
  }
  return br ? new Date(ano, mes - 1, dia) : ref;
}

/** Coluna @db.Date como a meia-noite UTC do mesmo dia (para comparar com hojeBrasilia). */
function diaUtc(d: Date): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Bandeira do corpo (true/1/'1'/'true') em 0/1 para coluna TINYINT. */
function simNao(valor: unknown): 0 | 1 {
  return valor === true || valor === 1 || valor === '1' || String(valor).toLowerCase() === 'true' ? 1 : 0;
}

/** Data @db.Date (meia-noite UTC) em DD/MM/AAAA; nula: ''. */
function dataDbBr(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '';
}

/**
 * Apuração das pautas em texto, gravada junto da ATA ao finalizar (a
 * assembleia é apagada e leva as votações). `opcoes` vem no formato da API,
 * "id;nome;votos" — o nome pode ter ';'.
 */
function textoApuracao(
  titulo: string,
  data: string,
  pautas: Array<{ titulo: string; descricao?: string; data_inicio: string; data_termino: string; opcoes: string[] }>,
): string {
  const linhas = [
    `Apuração das pautas - ${titulo}${data ? ` (${data})` : ''}`,
    `Registrada ao finalizar a assembleia, em ${formatarDataHoraBrasilia(new Date())} (horário de Brasília).`,
    'Conta um voto por unidade: o mais recente de cada unidade.',
  ];
  pautas.forEach((p, i) => {
    linhas.push('', `${i + 1}. ${p.titulo}`);
    if (p.descricao) linhas.push(`   ${p.descricao}`);
    if (p.data_inicio || p.data_termino) linhas.push(`   Período: ${p.data_inicio} a ${p.data_termino}`);
    let total = 0;
    for (const op of p.opcoes) {
      const partes = op.split(';');
      const votos = Number(partes[partes.length - 1]) || 0;
      total += votos;
      linhas.push(`   - ${partes.slice(1, -1).join(';')}: ${votos} voto(s)`);
    }
    linhas.push(`   Total: ${total} voto(s)`);
  });
  return `${linhas.join('\n')}\n`;
}

/** Unidade do usuário no condomínio, para votar e mostrar o voto dela. */
export type UnidadeVoto = { id_apto: number; rotulo: string };

/** Unidade do usuário com o vínculo mais alto dele nela (uso interno). */
type UnidadeDoUsuario = UnidadeVoto & { tipo: TipoVinculo };

/** Rótulo da unidade: "Apto 11 Bloco A", "Apto 31", o bloco, ou "Unidade 5". */
function rotuloDaUnidade(
  idApto: number,
  apartamento: { bloco?: string | null; apto?: string | null } | null | undefined,
): string {
  const apto = (apartamento?.apto ?? '').trim();
  const bloco = rotuloBloco(apartamento?.bloco);
  return apto ? (bloco ? `Apto ${apto} ${bloco}` : `Apto ${apto}`) : bloco || `Unidade ${idApto}`;
}

const MSG_ASSEMBLEIA_FINALIZADA_VOTO = 'Esta assembleia já foi finalizada; a votação está encerrada.';

const NOME_DO_VINCULO: Record<TipoVinculo, string> = {
  proprietario: 'proprietário',
  inquilino: 'inquilino',
  membro: 'membro da unidade',
};

/**
 * Por que o vínculo não vota nesta votação (null: vota). Pauta de assembleia
 * (`id_assembleia` preenchido): membro não vota; `somente_proprietarios` barra
 * inquilino e membro em pauta e em enquete.
 */
function motivoSemDireito(
  votacao: { id_assembleia: number | null; somente_proprietarios?: number | null },
  tipo: TipoVinculo,
): string | null {
  const pauta = votacao.id_assembleia != null;
  if (pauta && tipo === 'membro') {
    return 'Membros da unidade não votam em pauta de assembleia: vota o proprietário (ou o inquilino, quando a pauta permite).';
  }
  if (votacao.somente_proprietarios && tipo !== 'proprietario') {
    return pauta ? 'Somente proprietários votam nesta pauta.' : 'Somente proprietários votam nesta enquete.';
  }
  return null;
}

/** 409 de quem tenta trocar o voto dado por um vínculo mais alto. */
function mensagemVotoProtegido(autor: TipoVinculo, quem: TipoVinculo): string {
  const dono = autor === 'proprietario' ? 'O proprietário' : 'O inquilino';
  return `${dono} da unidade já votou; o voto dele não pode ser alterado por ${NOME_DO_VINCULO[quem]}.`;
}

/** Voto que vale hoje numa unidade do usuário (`opcao` nulo: a unidade não votou). */
export type VotoDaUnidade = { id_votacao: number; id_apto: number; rotulo: string; opcao: string | null };

/** Voto apurado de uma unidade: o mais recente dela. */
type VotoApurado = { id: number; id_opcao: number; t: number };

@Injectable()
export class AssembleiasService {
  private readonly logger = new Logger(AssembleiasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantAccessService,
    // Global (NotificationsModule). Opcional só porque vários specs instanciam o service sem ele.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Push aos moradores (mesmo envio e preferência do "Novo comunicado"). Sem
   * esperar e sem lançar: falha no push não desfaz o que já foi gravado.
   */
  private avisarMoradores(idCondominio: number, titulo: string, corpo: string, data: Record<string, string>) {
    void avisarMoradoresDoCondominio(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      idCondominio,
      { titulo, corpo, data },
    );
  }

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
    // Datas no formato YYYY-MM-DD ou DD/MM/YYYY (antes do upload: data ruim não sobe anexo)
    const dataObj = dataDaAssembleia(assembleia.data);
    if (!this.prisma.isConnected) return { success: true };

    // Processar anexos (docs) — upload real para R2 quando vierem em base64.
    // Assembleia nova não tem anexo gravado.
    const listDocs = await this.uploadDocs(assembleia.docs, 'assembleias', []);

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

    const criada = await this.prisma.assembleias.create({
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

    // Convocação: avisa só na criação (edição não).
    const hora = String(assembleia.hora ?? '').match(/(\d{2}):(\d{2})/);
    const quando = [dataDbBr(dataObj), hora ? `às ${hora[1]}:${hora[2]}` : ''].filter(Boolean).join(' ');
    this.avisarMoradores(
      Number(idCondominio),
      'Assembleia convocada',
      quando ? `${assembleia.titulo} — ${quando}` : assembleia.titulo,
      { type: 'assembleia', id: String(criada?.id ?? '') },
    );

    return { success: true };
  }

  async update(idCondominio: number, assembleia: any, userId: number, requester?: JwtPayload) {
    assertStaff(requester, 'editar assembleia');
    await this.tenant.assertCondominio(idCondominio, requester);
    if (assembleia.titulo !== undefined) assembleia.titulo = tituloObrigatorio(assembleia.titulo);
    const dataObj = dataDaAssembleia(assembleia.data);
    if (!this.prisma.isConnected) return { success: true };

    const listDocs = await this.uploadDocs(assembleia.docs, 'assembleias', () =>
      this.anexosGravados(Number(assembleia.id), Number(idCondominio)),
    );

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

  /** `userId` nulo: operador do console sem Users.id — sem voto próprio. */
  async get(idCondominio: number, idAssembleia: number, userId: number | null, requester?: JwtPayload) {
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
    const meusVotos = userId ? await this.getMyVotosAssembleia(Number(idAssembleia), Number(userId)) : [];
    // Novo: as unidades do usuário e o voto que vale em cada uma.
    const unidades = userId ? await this.unidadesDoUsuario(Number(idCondominio), Number(userId)) : [];

    return {
      assembleia: assembleiaFormatada,
      votacoes,
      meusVotos,
      unidades: unidades.map(({ id_apto, rotulo }) => ({ id_apto, rotulo })),
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
      select: { id_condominio: true, titulo: true, data: true },
    });
    if (!alvo) throw new NotFoundException('Assembleia não encontrada');
    await this.tenant.assertEntidade(alvo.id_condominio, requester, `assembleia #${assembleia.id}`);

    // Sem o arquivo, a ATA era gravada com link vazio e a assembleia apagada
    // mesmo assim (o console não mandava `doc`). Data URL tem de ser
    // application/pdf; URL (um anexo da assembleia) tem de terminar em .pdf —
    // antes uma foto anexada passava como "PDF da ATA".
    const doc = typeof assembleia.doc === 'string' ? assembleia.doc.trim() : '';
    const ehPdf = this.storage.isDataUrl(doc)
      ? /^data:application\/pdf[;,]/i.test(doc)
      : /\.pdf$/i.test(doc.split(/[?#]/)[0]);
    if (!doc || !ehPdf) {
      throw new BadRequestException('Anexe o PDF da ATA.');
    }

    // Título e data do banco: os do corpo só serviam para nomear a ATA, e o
    // cliente podia mandar qualquer coisa.
    const tituloAta = String(alvo.titulo ?? '').trim();
    const dataAta = dataDbBr(alvo.data);

    // Condomínio da ASSEMBLEIA, não o do corpo: um síndico com vínculo em A e
    // B finalizando a de B com id_condominio = A não achava as pautas (nenhuma
    // apuração), gravava a ATA em A e apagava a de B com os votos.
    const idCond = alvo.id_condominio;

    // A ATA pode ser um dos anexos da própria assembleia; outra URL do bucket, não.
    await this.storage.exigirArquivoDoRegistro(doc, () =>
      this.anexosGravados(Number(assembleia.id), idCond),
    );

    // Arquivos que ESTA chamada subiu: se algo falha adiante, saem do bucket.
    // O anexo da assembleia usado como ATA nunca entra aqui (não é upload).
    const enviados: string[] = [];
    try {
      let linkDoc = doc;
      if (this.storage.isDataUrl(doc)) {
        // Sem storage o upload devolve a própria data URL (não cabe em link_doc).
        linkDoc = (await this.storage.uploadDataUrl(doc, 'atas')) ?? '';
        if (!/^https?:\/\//i.test(linkDoc)) {
          throw new BadRequestException('Não foi possível guardar o PDF da ATA. Tente de novo.');
        }
        enviados.push(linkDoc);
      }

      const nomeAta = `ATA ${tituloAta}${dataAta ? ` - ${dataAta}` : ''}`.slice(0, 255);

      // O delete leva as pautas, as opções e os votos (cascade). A apuração de
      // cada pauta fica num arquivo de texto publicado junto da ATA (sem coluna
      // nova: Documentos só tem nome VarChar(255) e link_doc VarChar(500)).
      const { formatadas: pautas } = await this.consultarVotacoes(Number(assembleia.id), false, idCond);
      let linkApuracao: string | null = null;
      if (pautas.length > 0) {
        const texto = textoApuracao(tituloAta, dataAta, pautas);
        // BOM: o navegador abre o .txt como UTF-8 (acentos).
        const dataUrl = `data:text/plain;base64,${Buffer.from(`\uFEFF${texto}`, 'utf8').toString('base64')}`;
        linkApuracao = (await this.storage.uploadDataUrl(dataUrl, 'atas')) ?? '';
        if (!/^https?:\/\//i.test(linkApuracao)) {
          throw new BadRequestException(
            'Não foi possível guardar a apuração das pautas. A assembleia não foi finalizada; tente de novo.',
          );
        }
        enviados.push(linkApuracao);
      }

      // ATA, apuração e a remoção juntas: se algo falha, a assembleia fica.
      let idAta: number | undefined;
      await this.prisma.$transaction(async (tx) => {
        const ata = await tx.documentos.create({
          data: {
            id_condominio: idCond,
            is_ata: 1,
            nome: nomeAta,
            link_doc: linkDoc,
          },
        });
        idAta = ata?.id;
        if (linkApuracao) {
          await tx.documentos.create({
            data: {
              id_condominio: idCond,
              is_ata: 1,
              nome: `Apuração das pautas - ${nomeAta}`.slice(0, 255),
              link_doc: linkApuracao,
            },
          });
        }
        await tx.assembleias.delete({
          where: { id: Number(assembleia.id) },
        });
      });
      // Um aviso pela ATA (a apuração vai junto, sem push próprio).
      this.avisarMoradores(idCond, 'ATA publicada', nomeAta, { type: 'ata', id: String(idAta ?? '') });
    } catch (e) {
      // Best-effort: deleteUrl não lança e só apaga dentro de `atas/`.
      for (const url of enviados) await this.storage.deleteUrl(url, ['atas/']);
      throw e;
    }

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
    // Inquilino não vota (despesa extraordinária, obra, convenção). O app
    // 1.2.48 não manda: 0.
    const somenteProprietarios = simNao(votacao.somente_proprietarios);

    const idAssembleia = votacao.id_assembleia ? Number(votacao.id_assembleia) : null;
    if (idAssembleia) {
      const assembleia = await this.prisma.assembleias.findFirst({
        where: { id: idAssembleia, id_condominio: Number(idCondominio) },
        select: { id: true },
      });
      if (!assembleia) throw new BadRequestException('Assembleia não encontrada neste condomínio.');
    }

    // Votação e opções juntas: sem votação órfã sem opções.
    let idVotacao: number | undefined;
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
          somente_proprietarios: somenteProprietarios,
        },
      });
      await tx.votacoes_Opcoes.createMany({
        data: opcoes.map((nome) => ({ id_votacao: created.id, nome })),
      });
      idVotacao = created.id;
    });

    // Enquete aberta à comunidade avisa na criação. Pauta de assembleia não:
    // a convocação já avisou.
    if (isEnquete || !idAssembleia) {
      // Início futuro: ainda não dá para votar, o texto não pode dizer "vote até".
      const abreDepois = dIni.getTime() > hojeBrasilia().getTime();
      const corpo = abreDepois
        ? `Nova enquete publicada: ${titulo}. Abre em ${dataDbBr(dIni).slice(0, 5)}.`
        : `${titulo} — vote até ${dataDbBr(dFim)}`;
      this.avisarMoradores(Number(idCondominio), 'Nova enquete', corpo, {
        type: 'enquete',
        id: String(idVotacao ?? ''),
      });
    }

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

  /**
   * Encerra a votação agora: grava `encerrada_em` (é o que a fecha). O término
   * gravado só é puxado para hoje (Brasília) quando estava no futuro, para o
   * período exibido não mentir — antes o encerramento era "término = ontem",
   * que calcStatusInt continua tratando nas linhas antigas. Encerrar de novo:
   * sucesso sem regravar. Não existe reabrir.
   */
  async finishVotacao(id: number, requester?: JwtPayload) {
    assertStaff(requester, 'encerrar votação/enquete');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.votacoes.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, encerrada_em: true, data_termino: true },
    });
    if (!atual) throw new NotFoundException('Votação não encontrada');
    await this.tenant.assertEntidade(atual.id_condominio, requester, `votação #${id}`);
    if (atual.encerrada_em) return { success: true };

    const hoje = hojeBrasilia();
    await this.prisma.votacoes.update({
      where: { id: Number(id) },
      data: {
        encerrada_em: new Date(),
        ...(atual.data_termino && diaUtc(atual.data_termino) > hoje ? { data_termino: hoje } : {}),
      },
    });

    return { success: true };
  }

  /**
   * Um voto por UNIDADE (votação × apartamento), de quem tem vínculo
   * (`Apartamentos_Users`) com a unidade, no condomínio da votação.
   *
   * Qual unidade:
   *  - `idApto` informado (app novo): tem de ser uma unidade do usuário neste
   *    condomínio, senão 403;
   *  - sem `idApto` (app antigo): a única unidade, ou a de menor `id_apto`
   *    quando há várias — a mesma "unidade atribuída" de antes.
   *
   * Quem vota (tipo do vínculo, o mais alto da conta na unidade):
   *  - pauta de assembleia (`id_assembleia` preenchido): proprietário; inquilino
   *    só se a pauta não é `somente_proprietarios` (Lei 4.591 art. 24 §4º);
   *    membro não vota (403);
   *  - enquete: qualquer vínculo, salvo `somente_proprietarios`.
   *
   * Quem troca o voto: o voto vigente da unidade só é substituído por vínculo
   * de nível IGUAL OU SUPERIOR ao de quem o deu (409). Voto vigente antigo, sem
   * `tipo_vinculo`: vale o vínculo atual do autor com a unidade; sem vínculo ou
   * sem conta, membro. Substituir não apaga: o anterior recebe `substituido_em`
   * (trilha). Mesmo autor e mesma opção: nada muda (idempotente).
   *
   * Vigentes da unidade U: os votos com `id_apto = U` e os antigos sem
   * `id_apto` (e sem retrato) das contas cuja unidade atribuída é U. A
   * transação trava a linha do apartamento (FOR UPDATE) e só então lê o
   * vigente, para dois votos simultâneos da unidade não gravarem duas linhas
   * vigentes; se ainda sobrar duplicata, a apuração fica com a mais recente.
   */
  async registerVoto(votacaoId: number, opcaoId: number, userId: number, requester?: JwtPayload, idApto?: number) {
    if (!this.prisma.isConnected) return { success: true };

    const votacao = await this.prisma.votacoes.findUnique({
      where: { id: Number(votacaoId) },
      include: { opcoes: { select: { id: true } }, assembleia: { select: { finalizada_em: true } } },
    });
    if (!votacao) throw new NotFoundException('Votação não encontrada');
    await this.tenant.assertEntidade(votacao.id_condominio, requester, `votação #${votacaoId}`);

    if (votacao.assembleia?.finalizada_em) {
      throw new BadRequestException(MSG_ASSEMBLEIA_FINALIZADA_VOTO);
    }
    const status = this.calcStatusInt(votacao.data_inicio, votacao.data_termino, votacao.encerrada_em);
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
    let minha: UnidadeDoUsuario;
    if (idApto != null) {
      const achada = minhasUnidades.find((u) => u.id_apto === idApto);
      if (!achada) throw new ForbiddenException('Você não tem vínculo com esta unidade.');
      minha = achada;
    } else {
      // App antigo: a menor id_apto (a lista vem ordenada).
      minha = minhasUnidades[0];
    }
    const unidade = minha.id_apto;

    const semDireito = motivoSemDireito(votacao, minha.tipo);
    if (semDireito) throw new ForbiddenException(semDireito);

    // Vínculos da unidade: nível do autor do voto antigo (sem retrato) e, para
    // os votos antigos sem id_apto, as contas cuja unidade atribuída é U.
    const contasDoApto = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: unidade },
      select: { id_user: true, tipo: true },
    });
    const tiposNaUnidade = new Map<number, Array<string | null>>();
    for (const v of contasDoApto) tiposNaUnidade.set(v.id_user, [...(tiposNaUnidade.get(v.id_user) ?? []), v.tipo]);
    const candidatos = [...new Set([Number(userId), ...contasDoApto.map((v) => v.id_user)])];
    const atribuidas = await this.unidadesAtribuidas(votacao.id_condominio, candidatos);
    const antigosDe = candidatos.filter((id) => atribuidas.get(id) === unidade);
    const nivelDoAutorAntigo = (idUser: number | null): TipoVinculo =>
      (idUser == null ? null : maiorVinculo(tiposNaUnidade.get(idUser) ?? [])) ?? 'membro';

    const nomeVotante = await this.nomeDoVotante(votacao.id_condominio, Number(userId));

    // READ COMMITTED: em REPEATABLE READ a leitura/escrita que não acha linhas
    // deixa gap lock no idx_vu_apto_opcao, e duas unidades DIFERENTES votando
    // pela primeira vez ao mesmo tempo podiam dar deadlock. A mesma unidade
    // segue serializada pelo FOR UPDATE. Deadlock residual (P2034): refaz até 2 vezes.
    for (let tentativa = 0; ; tentativa++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // Serializa os votos da unidade: o segundo espera o primeiro
            // confirmar e então vê o voto que ele gravou como vigente.
            await tx.$queryRaw`SELECT id FROM Apartamentos WHERE id = ${unidade} FOR UPDATE`;
            const vigentes = await tx.votacoes_Usuarios.findMany({
              where: {
                id_opcao: { in: idsOpcoes },
                substituido_em: null,
                OR: [{ id_apto: unidade }, { id_apto: null, tipo_vinculo: null, id_user: { in: antigosDe } }],
              },
              select: { id: true, id_opcao: true, id_user: true, tipo_vinculo: true, created_at: true },
              orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            });
            const atual = vigentes[0];
            if (atual) {
              const nivelAtual = atual.tipo_vinculo
                ? normalizarTipoVinculo(atual.tipo_vinculo)
                : nivelDoAutorAntigo(atual.id_user);
              if (nivelVinculo(minha.tipo) < nivelVinculo(nivelAtual)) {
                throw new ConflictException(mensagemVotoProtegido(nivelAtual, minha.tipo));
              }
              if (atual.id_user === Number(userId) && atual.id_opcao === Number(opcaoId)) return;
              await tx.votacoes_Usuarios.updateMany({
                where: { id: { in: vigentes.map((v) => v.id) } },
                data: { substituido_em: new Date() },
              });
            }
            await tx.votacoes_Usuarios.create({
              data: {
                id_opcao: Number(opcaoId),
                id_user: Number(userId),
                id_apto: unidade,
                tipo_vinculo: minha.tipo,
                nome_votante: nomeVotante,
                rotulo_unidade: minha.rotulo.slice(0, 120),
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

  /**
   * Nome do votante para o retrato do voto: o do cadastro de morador da conta
   * NESTE condomínio, senão `Users.name`; nenhum: null.
   */
  private async nomeDoVotante(idCondominio: number, userId: number): Promise<string | null> {
    const morador = await this.prisma.moradores.findFirst({
      where: { id_user: userId, id_condominio: idCondominio },
      select: { nome: true },
      orderBy: { id: 'asc' },
    });
    const nome = (morador?.nome ?? '').trim();
    if (nome) return nome.slice(0, 255);
    const user = await this.prisma.users.findUnique({ where: { id: userId }, select: { name: true } });
    return (user?.name ?? '').trim().slice(0, 255) || null;
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
        substituido_em: null,
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

    return {
      votacao,
      meuVoto,
      unidades: unidades.map(({ id_apto, rotulo }) => ({ id_apto, rotulo })),
      votosPorUnidade: this.votosPorUnidade([votacao.id], unidades, apuracao),
    };
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
        .flatMap((v) => v.opcoes.flatMap((op) => op.votos.map((voto) => voto.id_user)))
        .filter((id): id is number => id != null);
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
          const unidade = this.unidadeDoVoto(voto.id_apto, voto.id_user == null ? undefined : vinculosDe.get(voto.id_user));
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
      // Linhas antigas encerradas no dia em que começaram têm término = ontem;
      // agendada encerrada antes de abrir tem término = hoje < início. Na
      // exibição o término nunca fica antes do início: "13/11 a 13/11".
      const fimExibido =
        v.data_termino && v.data_inicio && v.data_termino.getTime() < v.data_inicio.getTime()
          ? v.data_inicio
          : v.data_termino;
      const dFimStr = fimExibido ? fimExibido.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

      // Computar o status como inteiro (0 = agendado, 1 = em andamento, 2 = finalizado)
      const statusInt = this.calcStatusInt(v.data_inicio, v.data_termino, v.encerrada_em);

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
        encerrada_em: v.encerrada_em ? new Date(v.encerrada_em).toISOString() : null,
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
   * repetir), em ordem de `id_apto` — a primeira é a unidade atribuída — com
   * o vínculo mais alto da conta em cada uma. Serve ao voto (qual unidade e se
   * pode votar) e ao app (escolher a unidade e mostrar o voto dela).
   */
  private async unidadesDoUsuario(idCondominio: number, userId: number): Promise<UnidadeDoUsuario[]> {
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: Number(userId), apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_apto: true, tipo: true, apartamento: { select: { bloco: true, apto: true } } },
    });
    const porApto = new Map<number, { id_apto: number; rotulo: string; tipos: Array<string | null> }>();
    for (const { id_apto, tipo, apartamento } of vinculos) {
      const atual = porApto.get(id_apto);
      if (atual) atual.tipos.push(tipo);
      else porApto.set(id_apto, { id_apto, rotulo: rotuloDaUnidade(id_apto, apartamento), tipos: [tipo] });
    }
    return [...porApto.values()]
      .map(({ tipos, ...u }) => ({ ...u, tipo: maiorVinculo(tipos) ?? 'proprietario' }))
      .sort((a, b) => a.id_apto - b.id_apto);
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
        // Só os votos vigentes: o substituído fica na tabela como trilha.
        substituido_em: null,
        opcao: {
          votacao: { id_assembleia: Number(idAssembleia) },
        },
      },
      select: { id_opcao: true },
    });

    return votosDb.map(v => String(v.id_opcao));
  }

  /**
   * 0 = agendada, 1 = em andamento, 2 = encerrada. `encerrada_em` preenchido
   * (Encerrar, ou a assembleia finalizada) fecha na hora; sem ele, valem as
   * datas — inclusive as linhas antigas encerradas com término = ontem.
   */
  private calcStatusInt(dIni?: Date | null, dFim?: Date | null, encerradaEm?: Date | null): number {
    if (encerradaEm) return 2;
    if (!dIni || !dFim) return 1;

    // As datas são @db.Date (meia-noite UTC). "Hoje" precisa ser o dia de
    // Brasília no mesmo formato: com a data UTC do servidor, a votação fechava
    // às 21h do último dia e abria às 21h da véspera.
    const hoje = hojeBrasilia();
    const inicio = diaUtc(dIni);
    const fim = diaUtc(dFim);

    if (fim < hoje) return 2; // finalizado
    if (inicio > hoje) return 0; // agendado
    return 1; // em andamento
  }
}
