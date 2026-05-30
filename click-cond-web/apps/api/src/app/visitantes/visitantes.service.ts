import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

export interface CreateVisitanteDto {
  nome: string;
  doc_identificacao?: string;
  data_hora_inicio?: string;
  data_hora_termino?: string;
  is_visitante?: number;
  is_prestador?: number;
  id_apartamento: number;
  id_condominio: number;
  foto_documento?: string;
  foto_pessoa?: string;
}

export interface UpdateVisitanteDto extends Partial<CreateVisitanteDto> {
  id: number;
}

@Injectable()
export class VisitantesService {
  private readonly logger = new Logger(VisitantesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private fireFacialSync(idVisitante: number) {
    this.facial
      .syncVisitante(idVisitante)
      .catch((err) => this.logger.warn(`Sync facial visitante ${idVisitante} falhou: ${err?.message ?? err}`));
  }

  private async resolveFoto(value: string | undefined | null): Promise<string | null> {
    if (!value) return value ?? null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'visitantes')) ?? null;
    }
    return value;
  }

  /**
   * Carrega contexto rico de um visitante para a auditoria: apto, bloco,
   * tipo (visitante/prestador), morador que convidou, janela de visita.
   *
   * O `detalhes` do auditLog mostra isso pro operador entender de relance:
   * "quem foi liberado, em qual apto, por quem, em que data".
   */
  private async carregarContextoVisitante(idVisitante: number) {
    const v = await this.prisma.visitantes.findUnique({
      where: { id: idVisitante },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
      },
    });
    if (!v) return null;

    // Morador que convidou (campo `user` em Visitantes = id_user do morador)
    let convidadoPor: { id: number; nome: string | null } | null = null;
    if (v.user) {
      const u = await this.prisma.users.findUnique({
        where: { id: v.user },
        select: { id: true, name: true },
      });
      if (u) convidadoPor = { id: u.id, nome: u.name };
    }

    const tipoLabel = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

    return {
      visitante: {
        id: v.id,
        nome: v.nome,
        documento: v.doc_identificacao,
        tipo: tipoLabel,
      },
      apartamento: v.apartamento
        ? {
            id: v.id_apartamento,
            bloco: v.apartamento.bloco,
            numero: v.apartamento.apto,
            label: v.apartamento.bloco
              ? `Bloco ${v.apartamento.bloco}, Apto ${v.apartamento.apto}`
              : `Apto ${v.apartamento.apto}`,
          }
        : null,
      convidadoPor,
      janela: {
        inicio: fmtDate(v.data_hora_inicio as any),
        termino: fmtDate(v.data_hora_termino as any),
      },
      status: {
        liberado: v.liberado === 1,
        dataEntrada: fmtDate(v.data_entrada as any),
        dataSaida: fmtDate(v.data_saida as any),
        codigoAcesso: v.codigo_acesso,
      },
    };
  }

  async findAll(idCondominio: number, search?: string) {
    if (!this.prisma.isConnected) {
      const mocks = [
        {
          id: 101,
          nome: 'Carlos Eduardo Pereira',
          doc_identificacao: 'RG 45.123.890-X',
          data_hora_inicio: new Date(),
          data_hora_termino: null,
          is_visitante: 1,
          is_prestador: 0,
          id_apartamento: 1,
          id_condominio: Number(idCondominio),
          created_at: new Date(),
          apartamento: { bloco: 'A', apto: '101' },
        },
        {
          id: 102,
          nome: 'Instalação Vivo Fibra (Técnico Marcos)',
          doc_identificacao: 'CPF 234.567.890-12',
          data_hora_inicio: new Date(Date.now() - 3600000),
          data_hora_termino: null,
          is_visitante: 0,
          is_prestador: 1,
          id_apartamento: 4,
          id_condominio: Number(idCondominio),
          created_at: new Date(Date.now() - 3600000),
          apartamento: { bloco: 'B', apto: '202' },
        },
        {
          id: 103,
          nome: 'Ana Julia Souza',
          doc_identificacao: 'RG 12.345.678-9',
          data_hora_inicio: new Date(Date.now() - 86400000),
          data_hora_termino: new Date(Date.now() - 72000000),
          is_visitante: 1,
          is_prestador: 0,
          id_apartamento: 15,
          id_condominio: Number(idCondominio),
          created_at: new Date(Date.now() - 86400000),
          apartamento: { bloco: 'A', apto: '504' },
        },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter(
          (m) =>
            m.nome.toLowerCase().includes(s) ||
            (m.doc_identificacao && m.doc_identificacao.toLowerCase().includes(s)),
        );
      }
      return mocks;
    }

    return this.prisma.visitantes.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { doc_identificacao: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return {
        id,
        nome: 'Carlos Eduardo Pereira',
        doc_identificacao: 'RG 45.123.890-X',
        data_hora_inicio: new Date(),
        data_hora_termino: null,
        is_visitante: 1,
        is_prestador: 0,
        id_apartamento: 1,
        id_condominio: 1,
        created_at: new Date(),
        apartamento: { bloco: 'A', apto: '101' },
      };
    }

    const v = await this.prisma.visitantes.findUnique({
      where: { id: Number(id) },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
    if (!v) throw new NotFoundException(`Visitante ${id} não encontrado`);
    return v;
  }

  /**
   * Busca um cadastro anterior da mesma pessoa no condomínio.
   * Critério: mesmo documento (normalizado) OU mesmo nome (case insensitive)
   * quando documento não é informado.
   * Retorna o registro mais informativo (com foto e face_id sincronizado de
   * preferência) para que possa ser reutilizado.
   */
  async buscarPessoa(idCondominio: number, doc?: string, nome?: string) {
    if (!this.prisma.isConnected) return null;

    const docNorm = doc?.trim();
    const nomeNorm = nome?.trim();
    if (!docNorm && !nomeNorm) return null;

    const candidatos = await this.prisma.visitantes.findMany({
      where: {
        id_condominio: Number(idCondominio),
        OR: [
          ...(docNorm ? [{ doc_identificacao: docNorm }] : []),
          ...(nomeNorm && !docNorm ? [{ nome: nomeNorm }] : []),
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    if (candidatos.length === 0) return null;

    // Prioriza candidato com foto_pessoa + face_sync_status='synced'
    const score = (v: typeof candidatos[number]) => {
      let s = 0;
      if (v.face_sync_status === 'synced') s += 100;
      if (v.face_id) s += 50;
      if (v.foto_pessoa) s += 30;
      if (v.foto_documento) s += 10;
      return s;
    };
    candidatos.sort((a, b) => score(b) - score(a));
    const melhor = candidatos[0];

    return {
      id: melhor.id,
      nome: melhor.nome,
      doc_identificacao: melhor.doc_identificacao,
      foto_pessoa: melhor.foto_pessoa,
      foto_documento: melhor.foto_documento,
      face_id: melhor.face_id,
      face_sync_status: melhor.face_sync_status,
      face_enrolled_at: melhor.face_enrolled_at?.toISOString() ?? null,
      totalVisitasAnteriores: candidatos.length,
    };
  }

  /**
   * Lista pessoas únicas no condomínio (agrupadas por documento, ou pelo
   * nome quando documento não existe). Cada pessoa é "1 linha", com o
   * registro principal escolhido por relevância e contadores agregados.
   *
   * Substitui o conceito anterior de "1 visita = 1 linha" — agora a lista
   * mostra pessoas e o card de detalhes (modal) mostra todas as visitas.
   */
  async listarPessoas(idCondominio: number, search?: string) {
    if (!this.prisma.isConnected) {
      return [];
    }

    const todas = await this.prisma.visitantes.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { doc_identificacao: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
    });

    type Reg = typeof todas[number];
    const grupos = new Map<string, Reg[]>();
    for (const v of todas) {
      const doc = (v.doc_identificacao ?? '').trim().toLowerCase();
      const key = doc || `nome:${(v.nome ?? '').trim().toLowerCase()}`;
      const arr = grupos.get(key) ?? [];
      arr.push(v);
      grupos.set(key, arr);
    }

    // Score do registro principal (qual representa a pessoa na lista)
    const score = (v: Reg) => {
      if (v.data_entrada && !v.data_saida) return 1000; // No condomínio agora
      if (v.codigo_acesso && v.liberado === 1) return 800; // PIN ativo e liberado!
      if (v.codigo_acesso) return 500;                  // PIN ativo / agendado
      const created = v.created_at ? new Date(v.created_at).getTime() : 0;
      return created / 1e10;
    };

    const pessoas = [];
    for (const arr of grupos.values()) {
      arr.sort((a, b) => score(b) - score(a));
      const principal = arr[0];

      const noLocal = arr.some((r) => r.data_entrada && !r.data_saida);
      const temPinAtivo = arr.some(
        (r) => r.codigo_acesso && !r.data_saida,
      );
      const totalVisitas = arr.length;

      // Última entrada conhecida (qualquer registro)
      const ultEntrada = arr
        .map((r) => r.data_entrada)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      // Última saída conhecida
      const ultSaida = arr
        .map((r) => r.data_saida)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      // Apartamento atual (do registro principal — ainda usado pelo backend
      // pra registrar entrada/saída; a UI esconde isso)
      const apto = principal.apartamento;
      const aptoStr = apto
        ? `${apto.apto ?? ''}${apto.bloco ? '/' + apto.bloco : ''}`.replace(/^\/|\/$/g, '')
        : null;

      // Apartamentos únicos visitados
      const aptosVisitados = new Map<number, string>();
      for (const r of arr) {
        if (r.apartamento) {
          aptosVisitados.set(
            r.apartamento.id,
            `${r.apartamento.apto ?? ''}${r.apartamento.bloco ? '/' + r.apartamento.bloco : ''}`,
          );
        }
      }

      pessoas.push({
        // Identidade da pessoa
        id: principal.id, // id do registro principal (compatível com ações antigas)
        nome: principal.nome,
        doc_identificacao: principal.doc_identificacao,
        foto_pessoa: principal.foto_pessoa,
        foto_documento: principal.foto_documento,
        is_visitante: principal.is_visitante,
        is_prestador: principal.is_prestador,
        liberado: arr.some((r) => r.liberado === 1 && !r.data_entrada && !r.data_saida) ? 1 : 0,

        // Facial
        face_id: principal.face_id,
        face_sync_status: principal.face_sync_status,

        // Status atual (agregado de TODAS as visitas)
        noLocal,
        temPinAtivo,
        statusLabel: noLocal
          ? 'No condomínio'
          : arr.some((r) => r.liberado === 1 && !r.data_entrada && !r.data_saida)
          ? 'Liberado'
          : temPinAtivo
          ? 'Agendado'
          : 'Histórico',

        // Resumo
        totalVisitas,
        visitasAnteriores: Math.max(0, totalVisitas - 1),
        apartamentosVisitados: Array.from(aptosVisitados.entries()).map(
          ([id, label]) => ({ id, label }),
        ),

        // Visita atual (registro principal)
        id_apartamento: principal.id_apartamento,
        apartamentoAtual: aptoStr,

        // Datas
        ultEntrada: ultEntrada?.toISOString() ?? null,
        ultSaida: ultSaida?.toISOString() ?? null,
        data_entrada: principal.data_entrada?.toISOString() ?? null,
        data_saida: principal.data_saida?.toISOString() ?? null,
        data_hora_inicio: principal.data_hora_inicio?.toISOString() ?? null,
        data_hora_termino: principal.data_hora_termino?.toISOString() ?? null,
        codigo_acesso: temPinAtivo ? principal.codigo_acesso : null,

        created_at: principal.created_at.toISOString(),
      });
    }

    // Ordena: quem está no local primeiro, depois quem tem PIN ativo, depois
    // pela visita mais recente
    pessoas.sort((a, b) => {
      if (a.noLocal !== b.noLocal) return a.noLocal ? -1 : 1;
      if (a.temPinAtivo !== b.temPinAtivo) return a.temPinAtivo ? -1 : 1;
      const ta = a.ultEntrada ? new Date(a.ultEntrada).getTime() : 0;
      const tb = b.ultEntrada ? new Date(b.ultEntrada).getTime() : 0;
      return tb - ta;
    });

    return pessoas;
  }

  /**
   * Cria uma "nova visita" para uma pessoa que já é cadastrada
   * (identificada pelo registro principal). Reutiliza foto, documento e
   * face_id automaticamente — só pede apartamento + validade.
   */
  async novaVisitaParaPessoa(
    idPessoaRef: number,
    dto: {
      id_apartamento: number;
      data_hora_inicio?: string;
      data_hora_termino?: string;
    },
  ) {
    const ref = await this.prisma.visitantes.findUnique({
      where: { id: Number(idPessoaRef) },
    });
    if (!ref) {
      throw new NotFoundException(`Pessoa de referência ${idPessoaRef} não encontrada`);
    }
    if (!dto.id_apartamento) {
      throw new BadRequestException('Informe o apartamento da nova visita');
    }
    return this.create({
      nome: ref.nome,
      doc_identificacao: ref.doc_identificacao ?? undefined,
      foto_pessoa: ref.foto_pessoa ?? undefined,
      foto_documento: ref.foto_documento ?? undefined,
      is_visitante: ref.is_visitante ?? 1,
      is_prestador: ref.is_prestador ?? 0,
      id_apartamento: Number(dto.id_apartamento),
      id_condominio: ref.id_condominio,
      data_hora_inicio: dto.data_hora_inicio,
      data_hora_termino: dto.data_hora_termino,
    });
  }

  /**
   * Remove TODAS as visitas de uma pessoa (mesmo documento ou mesmo nome
   * quando não há documento), e também desinscreve do terminal facial.
   * Usado pelo botão "Remover" da lista de pessoas.
   */
  async removerPessoa(idCondominio: number, idPessoaRef: number) {
    const ref = await this.prisma.visitantes.findUnique({
      where: { id: Number(idPessoaRef) },
    });
    if (!ref || ref.id_condominio !== Number(idCondominio)) {
      throw new NotFoundException(`Pessoa ${idPessoaRef} não encontrada`);
    }

    const doc = ref.doc_identificacao?.trim();
    const where = doc
      ? { id_condominio: ref.id_condominio, doc_identificacao: doc }
      : { id_condominio: ref.id_condominio, nome: ref.nome };

    const registros = await this.prisma.visitantes.findMany({
      where,
      select: { id: true, face_id: true, id_condominio: true },
    });

    // Coleta face_ids únicos pra desinscrever do terminal
    const faceIds = new Set(
      registros.map((r) => r.face_id).filter((f): f is string => !!f),
    );

    const result = await this.prisma.visitantes.deleteMany({ where });

    await this.auditoria.registrar({
      id_condominio: ref.id_condominio,
      usuario_nome: 'Sistema / Portaria',
      acao: 'DELETE',
      modulo: 'visitantes',
      entidade_id: ref.id,
      descricao: `Cadastro da pessoa "${ref.nome}" e todas as suas visitas associadas foram excluídos.`,
    });

    // Best-effort: desinscreve do terminal
    for (const faceId of faceIds) {
      this.facial
        .unsyncVisitante(0, faceId, ref.id_condominio)
        .catch((err) =>
          this.logger.warn(`Unsync facial pessoa removida (${faceId}): ${err?.message ?? err}`),
        );
    }

    return { ok: true, removidos: result.count };
  }

  /**
   * Atualiza dados de IDENTIDADE de uma pessoa em TODOS os seus registros
   * (mesmo doc/nome no condomínio). Usado pelo "Editar" da lista. Não mexe
   * em apartamento, datas de visita ou PIN — esses pertencem a cada visita.
   */
  async atualizarPessoa(
    idCondominio: number,
    idPessoaRef: number,
    dto: {
      nome?: string;
      doc_identificacao?: string;
      foto_pessoa?: string;
      foto_documento?: string;
      is_visitante?: number;
      is_prestador?: number;
    },
  ) {
    const ref = await this.prisma.visitantes.findUnique({
      where: { id: Number(idPessoaRef) },
    });
    if (!ref || ref.id_condominio !== Number(idCondominio)) {
      throw new NotFoundException(`Pessoa ${idPessoaRef} não encontrada`);
    }

    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    const docRef = ref.doc_identificacao?.trim();
    const where = docRef
      ? { id_condominio: ref.id_condominio, doc_identificacao: docRef }
      : { id_condominio: ref.id_condominio, nome: ref.nome };

    const data: any = {};
    if (dto.nome !== undefined) data.nome = dto.nome;
    if (dto.doc_identificacao !== undefined) data.doc_identificacao = dto.doc_identificacao;
    if (fotoPes !== undefined) data.foto_pessoa = fotoPes;
    if (fotoDoc !== undefined) data.foto_documento = fotoDoc;
    if (dto.is_visitante !== undefined) data.is_visitante = dto.is_visitante;
    if (dto.is_prestador !== undefined) data.is_prestador = dto.is_prestador;

    const result = await this.prisma.visitantes.updateMany({ where, data });

    await this.auditoria.registrar({
      id_condominio: ref.id_condominio,
      usuario_nome: 'Sistema / Portaria',
      acao: 'UPDATE',
      modulo: 'visitantes',
      entidade_id: ref.id,
      descricao: `Cadastro da pessoa "${dto.nome || ref.nome}" atualizado com sucesso.`,
    });

    // Se a foto mudou e havia face_id, re-sincroniza
    if (fotoPes && ref.face_id) {
      this.fireFacialSync(ref.id);
    }

    return { ok: true, atualizados: result.count };
  }

  async create(dto: CreateVisitanteDto) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        nome: dto.nome,
        doc_identificacao: dto.doc_identificacao ?? null,
        data_hora_inicio: dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : new Date(),
        data_hora_termino: dto.data_hora_termino ? new Date(dto.data_hora_termino) : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        id_apartamento: dto.id_apartamento,
        id_condominio: dto.id_condominio,
        foto_documento: dto.foto_documento ?? null,
        foto_pessoa: dto.foto_pessoa ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    let fotoDoc = await this.resolveFoto(dto.foto_documento);
    let fotoPes = await this.resolveFoto(dto.foto_pessoa);

    // Reutilização: se o operador NÃO enviou foto, tenta puxar de um
    // cadastro anterior da mesma pessoa no condomínio (mesmo documento).
    // Também herda face_id pra evitar duplicar no terminal facial.
    let faceIdHerdado: string | null = null;
    let faceSyncHerdado: string | null = null;
    let faceEnrolledHerdado: Date | null = null;
    if (!fotoPes && dto.doc_identificacao?.trim()) {
      const anterior = await this.buscarPessoa(dto.id_condominio, dto.doc_identificacao, dto.nome);
      if (anterior) {
        if (!fotoPes && anterior.foto_pessoa) fotoPes = anterior.foto_pessoa;
        if (!fotoDoc && anterior.foto_documento) fotoDoc = anterior.foto_documento;
        if (anterior.face_id) {
          faceIdHerdado = anterior.face_id;
          faceSyncHerdado = anterior.face_sync_status;
          faceEnrolledHerdado = anterior.face_enrolled_at ? new Date(anterior.face_enrolled_at) : null;
        }
        this.logger.log(
          `Visitante ${dto.nome} (doc=${dto.doc_identificacao}) tem ${anterior.totalVisitasAnteriores} cadastro(s) anterior(es); reutilizando foto/face_id.`,
        );
      }
    }

    // Reutilizar registro ativo existente (mesmo doc, ou mesmo nome se sem doc)
    let existingActive: any = null;
    const docNorm = dto.doc_identificacao?.trim();
    if (docNorm) {
      existingActive = await this.prisma.visitantes.findFirst({
        where: {
          id_condominio: Number(dto.id_condominio),
          doc_identificacao: docNorm,
          data_entrada: null,
          data_saida: null,
        },
        orderBy: { id: 'desc' },
      });
    } else if (dto.nome?.trim()) {
      existingActive = await this.prisma.visitantes.findFirst({
        where: {
          id_condominio: Number(dto.id_condominio),
          nome: dto.nome.trim(),
          doc_identificacao: null,
          data_entrada: null,
          data_saida: null,
        },
        orderBy: { id: 'desc' },
      });
    }

    if (existingActive) {
      this.logger.log(`Reutilizando agendamento ativo (id=${existingActive.id}) para "${dto.nome}".`);
      const updated = await this.prisma.visitantes.update({
        where: { id: existingActive.id },
        data: {
          nome: dto.nome,
          doc_identificacao: dto.doc_identificacao ?? existingActive.doc_identificacao,
          data_hora_inicio: dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : existingActive.data_hora_inicio,
          data_hora_termino: dto.data_hora_termino ? new Date(dto.data_hora_termino) : existingActive.data_hora_termino,
          is_visitante: dto.is_visitante ?? existingActive.is_visitante,
          is_prestador: dto.is_prestador ?? existingActive.is_prestador,
          id_apartamento: dto.id_apartamento,
          foto_documento: fotoDoc ?? existingActive.foto_documento,
          foto_pessoa: fotoPes ?? existingActive.foto_pessoa,
          face_id: faceIdHerdado ?? existingActive.face_id,
          face_sync_status: faceSyncHerdado ?? existingActive.face_sync_status,
          face_enrolled_at: faceEnrolledHerdado ?? existingActive.face_enrolled_at,
          liberado: 1,
        },
      });

      const tipoLabel = updated.is_prestador === 1 ? 'Prestador' : 'Visitante';
      await this.auditoria.registrar({
        id_condominio: updated.id_condominio,
        usuario_nome: 'Sistema / Portaria',
        acao: 'UPDATE',
        modulo: 'visitantes',
        entidade_id: updated.id,
        descricao: `Agendamento existente atualizado para ${tipoLabel} "${updated.nome}".`,
      });

      // Desativar qualquer outra visita ativa/duplicada
      await this.desativarOutrosCodigos(updated.id_condominio, updated.id, updated.nome, updated.doc_identificacao);

      // Notificar moradores
      try {
        const moradores = await this.prisma.users.findMany({
          where: {
            apartamentosUsers: {
              some: {
                id_apto: dto.id_apartamento,
              },
            },
            fcm_token: { not: null },
            notif_visitantes: 1,
          },
          select: { fcm_token: true },
        });

        for (const m of moradores) {
          if (m.fcm_token) {
            await this.notifications.sendPushNotification(
              m.fcm_token,
              dto.is_prestador ? 'Prestador de Serviço' : 'Chegada de Visitante',
              `${dto.nome} acabou de chegar para o seu apartamento.`,
              { id: updated.id.toString(), type: 'visitante' },
            );
          }
        }
      } catch (error) {
        console.error('Erro ao notificar moradores sobre visitante:', error);
      }

      if (fotoPes && !faceIdHerdado) {
        this.fireFacialSync(updated.id);
      }

      return updated;
    }

    // Gerar PIN único e ativo
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await this.prisma.visitantes.findFirst({
        where: { codigo_acesso: pin, data_saida: null },
      });
      if (!check) {
        isUnique = true;
      }
    }

    const visitante = await this.prisma.visitantes.create({
      data: {
        nome: dto.nome,
        doc_identificacao: dto.doc_identificacao ?? null,
        data_hora_inicio: dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : new Date(),
        data_hora_termino: dto.data_hora_termino ? dto.data_hora_termino ? new Date(dto.data_hora_termino) : null : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        id_apartamento: dto.id_apartamento,
        id_condominio: dto.id_condominio,
        foto_documento: fotoDoc,
        foto_pessoa: fotoPes,
        codigo_acesso: pin,
        face_id: faceIdHerdado,
        face_sync_status: faceSyncHerdado,
        face_enrolled_at: faceEnrolledHerdado,
        liberado: 1,
      },
    });

    const tipoLabel = visitante.is_prestador === 1 ? 'Prestador' : 'Visitante';
    const ctxCreate = await this.carregarContextoVisitante(visitante.id);
    const aptoLabelCreate = ctxCreate?.apartamento?.label ?? '—';
    await this.auditoria.registrar({
      id_condominio: visitante.id_condominio,
      usuario_nome: 'Sistema / Portaria',
      acao: 'CREATE',
      modulo: 'visitantes',
      entidade_id: visitante.id,
      descricao: `Novo agendamento: ${tipoLabel} "${visitante.nome}" para ${aptoLabelCreate}`,
      detalhes: ctxCreate ?? undefined,
    });

    // Notificar moradores
    try {
      const moradores = await this.prisma.users.findMany({
        where: {
          apartamentosUsers: {
            some: {
              id_apto: dto.id_apartamento,
            },
          },
          fcm_token: { not: null },
          notif_visitantes: 1,
        },
        select: { fcm_token: true },
      });

      for (const m of moradores) {
        if (m.fcm_token) {
          await this.notifications.sendPushNotification(
            m.fcm_token,
            dto.is_prestador ? 'Prestador de Serviço' : 'Chegada de Visitante',
            `${dto.nome} acabou de chegar para o seu apartamento.`,
            { id: visitante.id.toString(), type: 'visitante' },
          );
        }
      }
    } catch (error) {
      console.error('Erro ao notificar moradores sobre visitante:', error);
    }

    // Sync facial: só dispara se há foto E o face_id ainda não foi herdado
    // de cadastro anterior (caso herdou, terminal já conhece a pessoa).
    if (fotoPes && !faceIdHerdado) {
      this.fireFacialSync(visitante.id);
    }

    return visitante;
  }

  async update(dto: UpdateVisitanteDto) {
    if (!this.prisma.isConnected) {
      return { success: true, id: dto.id };
    }

    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;
    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;

    try {
      const updated = await this.prisma.visitantes.update({
        where: { id: Number(dto.id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.doc_identificacao !== undefined && { doc_identificacao: dto.doc_identificacao }),
          ...(dto.data_hora_inicio !== undefined && {
            data_hora_inicio: new Date(dto.data_hora_inicio),
          }),
          ...(dto.data_hora_termino !== undefined && {
            data_hora_termino: dto.data_hora_termino ? new Date(dto.data_hora_termino) : null,
          }),
          ...(dto.is_visitante !== undefined && { is_visitante: dto.is_visitante }),
          ...(dto.is_prestador !== undefined && { is_prestador: dto.is_prestador }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: dto.id_apartamento }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
        },
      });
      if (fotoPes !== undefined && fotoPes) {
        this.fireFacialSync(updated.id);
      }
      const label = updated.is_prestador === 1 ? 'Prestador' : 'Visitante';
      await this.auditoria.registrar({
        id_condominio: updated.id_condominio,
        usuario_nome: 'Sistema / Portaria',
        acao: 'UPDATE',
        modulo: 'visitantes',
        entidade_id: updated.id,
        descricao: `Dados da visita de ${label} "${updated.nome}" atualizados com sucesso.`,
      });
      return updated;
    } catch {
      throw new NotFoundException(`Visitante ${dto.id} não encontrado`);
    }
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    const v = await this.prisma.visitantes.findUnique({
      where: { id: Number(id) },
      select: { face_id: true, id_condominio: true, nome: true, is_prestador: true },
    });
    try {
      await this.prisma.visitantes.delete({ where: { id: Number(id) } });
      if (v) {
        const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
        await this.auditoria.registrar({
          id_condominio: v.id_condominio,
          usuario_nome: 'Sistema / Portaria',
          acao: 'DELETE',
          modulo: 'visitantes',
          entidade_id: Number(id),
          descricao: `Visita agendada de ${label} "${v.nome}" removida com sucesso.`,
        });
      }
    } catch {
      throw new NotFoundException(`Visitante ${id} não encontrado`);
    }
    if (v?.face_id) {
      this.facial
        .unsyncVisitante(id, v.face_id, v.id_condominio)
        .catch((err) => this.logger.warn(`Unsync facial visitante ${id} falhou: ${err?.message ?? err}`));
    }
    return { success: true };
  }

  async validarCodigo(idCondominio: number, codigo: string) {
    const v = await this.prisma.visitantes.findFirst({
      where: {
        id_condominio: Number(idCondominio),
        codigo_acesso: codigo,
        data_saida: null,
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        criadoPor: { select: { name: true } },
      },
    });

    if (!v) {
      throw new NotFoundException('Código inválido ou visita não agendada/já encerrada.');
    }

    const now = new Date();
    const inicio = v.data_hora_inicio ? new Date(v.data_hora_inicio) : now;
    const termino = v.data_hora_termino ? new Date(v.data_hora_termino) : now;

    // Grace periods: 15 minutes before start, 15 minutes after end to account for server clock drift
    const GRACE_PERIOD_MS = 15 * 60 * 1000;
    const inicioComTolerancia = new Date(inicio.getTime() - GRACE_PERIOD_MS);
    const terminoComTolerancia = new Date(termino.getTime() + GRACE_PERIOD_MS);

    let status = 'ATIVO';
    if (now < inicioComTolerancia) {
      status = 'FUTURO';
    } else if (now > terminoComTolerancia) {
      status = 'EXPIRADO';
    }

    if (status === 'EXPIRADO') {
      throw new BadRequestException('Acesso negado: O período de validade deste código já expirou.');
    }
    if (status === 'FUTURO') {
      throw new BadRequestException('Acesso negado: O período de validade deste código ainda não iniciou.');
    }

    if (v.liberado !== 1) {
      throw new BadRequestException('Acesso negado: A entrada deste visitante/prestador não foi autorizada pelo morador ou portaria.');
    }

    const formatarData = (d: Date | null) => {
      if (!d) return '';
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    return {
      id: v.id,
      nome: v.nome,
      doc_identificacao: v.doc_identificacao,
      data_inicio: formatarData(v.data_hora_inicio),
      data_termino: formatarData(v.data_hora_termino),
      is_visitante: v.is_visitante,
      is_prestador: v.is_prestador,
      foto_documento: v.foto_documento,
      foto_pessoa: v.foto_pessoa,
      apto: v.apartamento?.apto ?? null,
      apto_bloco: v.apartamento?.bloco ?? null,
      morador_nome: v.criadoPor?.name ?? 'Morador',
      status_vigencia: status,
    };
  }

  async detalhes(id: number) {
    if (!this.prisma.isConnected) {
      throw new NotFoundException('Banco indisponível');
    }

    const v = await this.prisma.visitantes.findUnique({
      where: { id: Number(id) },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
        criadoPor: { select: { name: true } },
        condominio: { select: { nome: true } },
      },
    });
    if (!v) throw new NotFoundException(`Visitante ${id} não encontrado`);

    // Outros registros do mesmo visitante (mesmo doc OU mesmo nome no mesmo condomínio)
    const docNorm = v.doc_identificacao?.trim();
    const outrasVisitas = await this.prisma.visitantes.findMany({
      where: {
        id_condominio: v.id_condominio,
        OR: [
          ...(docNorm ? [{ doc_identificacao: docNorm }] : []),
          { nome: v.nome },
        ],
        NOT: { id: v.id },
      },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    const todasVisitas = [v, ...outrasVisitas];
    const todosVisIds = todasVisitas.map((x) => x.id);

    // Acessos faciais de qualquer um desses registros
    const acessosFacial = todosVisIds.length > 0
      ? await this.prisma.acessos_Facial.findMany({
          where: {
            tipo_pessoa: 'visitante',
            id_pessoa: { in: todosVisIds },
          },
          orderBy: { timestamp: 'desc' },
          take: 100,
        })
      : [];

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: v.id_condominio },
      select: { id: true, nome: true },
    });
    const deviceNomePor = new Map(devices.map((d) => [d.id, d.nome]));

    // Monta a timeline (mais recente primeiro)
    const DEDUP_MS = 15_000;
    const facialBuckets = new Set<string>();
    for (const a of acessosFacial) {
      const b = Math.floor(a.timestamp.getTime() / DEDUP_MS);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b - 1}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b + 1}`);
    }
    const isDup = (idVis: number, evento: 'entrada' | 'saida', ts: Date) => {
      const b = Math.floor(ts.getTime() / DEDUP_MS);
      return facialBuckets.has(`${idVis}:${evento}:${b}`);
    };

    type TimelineEntry = {
      evento: 'entrada' | 'saida' | 'negado';
      timestamp: string;
      metodo: 'facial' | 'pin';
      metodoLabel: string;
      confianca?: number;
      terminalNome?: string;
      idApartamento?: number;
      blocoApto?: string;
      idVisitanteRegistro: number;
      observacao?: string;
    };

    const timeline: TimelineEntry[] = [];

    // Acessos faciais
    for (const a of acessosFacial) {
      const visitanteReg = todasVisitas.find((x) => x.id === a.id_pessoa);
      const apto = visitanteReg?.apartamento;
      let obs = undefined;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        obs = match[1];
      }
      timeline.push({
        evento: a.evento === 'saida' ? 'saida' : a.evento === 'negado' ? 'negado' : 'entrada',
        timestamp: a.timestamp.toISOString(),
        metodo: 'facial',
        metodoLabel: 'Terminal Facial',
        confianca: a.confianca ?? undefined,
        terminalNome: deviceNomePor.get(a.id_device) ?? `Terminal #${a.id_device}`,
        idApartamento: apto?.id,
        blocoApto: apto ? `${apto.apto ?? ''}${apto.bloco ?? ''}`.trim() : undefined,
        idVisitanteRegistro: a.id_pessoa!,
        observacao: obs,
      });
    }

    // Entradas/Saídas por PIN/Manual (que não casam com acesso facial)
    for (const reg of todasVisitas) {
      const apto = reg.apartamento;
      const blocoApto = apto ? `${apto.apto ?? ''}${apto.bloco ?? ''}`.trim() : undefined;
      if (reg.data_entrada && !isDup(reg.id, 'entrada', reg.data_entrada)) {
        timeline.push({
          evento: 'entrada',
          timestamp: reg.data_entrada.toISOString(),
          metodo: 'pin',
          metodoLabel: 'PIN / Manual',
          idApartamento: apto?.id,
          blocoApto,
          idVisitanteRegistro: reg.id,
        });
      }
      if (reg.data_saida && !isDup(reg.id, 'saida', reg.data_saida)) {
        timeline.push({
          evento: 'saida',
          timestamp: reg.data_saida.toISOString(),
          metodo: 'pin',
          metodoLabel: 'PIN / Manual',
          idApartamento: apto?.id,
          blocoApto,
          idVisitanteRegistro: reg.id,
        });
      }
    }

    timeline.sort(
      (x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime(),
    );

    // Stats
    const totalEntradas = timeline.filter((t) => t.evento === 'entrada').length;
    const totalSaidas = timeline.filter((t) => t.evento === 'saida').length;
    const totalNegados = timeline.filter((t) => t.evento === 'negado').length;
    const primeira = timeline.length > 0 ? timeline[timeline.length - 1].timestamp : null;
    const ultima = timeline.length > 0 ? timeline[0].timestamp : null;
    const acessosFaciais = timeline.filter((t) => t.metodo === 'facial').length;
    const acessosPin = timeline.filter((t) => t.metodo === 'pin').length;

    // Calcula tempo médio dentro do condomínio (pareando entrada/saída em ordem)
    const cron = [...timeline].sort(
      (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime(),
    );
    let permanenciaTotalMs = 0;
    let permanenciaCount = 0;
    let entradaAberta: TimelineEntry | null = null;
    for (const ev of cron) {
      if (ev.evento === 'entrada') {
        entradaAberta = ev;
      } else if (ev.evento === 'saida' && entradaAberta) {
        permanenciaTotalMs +=
          new Date(ev.timestamp).getTime() - new Date(entradaAberta.timestamp).getTime();
        permanenciaCount++;
        entradaAberta = null;
      }
    }
    const tempoMedioMs = permanenciaCount > 0 ? permanenciaTotalMs / permanenciaCount : null;

    // Lista única de apartamentos visitados
    const apartamentosVisitados = new Map<number, { id: number; blocoApto: string; visitas: number }>();
    for (const reg of todasVisitas) {
      if (!reg.apartamento) continue;
      const a = reg.apartamento;
      const key = a.id;
      const blocoApto = `${a.apto ?? ''}${a.bloco ?? ''}`.trim();
      const existing = apartamentosVisitados.get(key);
      if (existing) {
        existing.visitas++;
      } else {
        apartamentosVisitados.set(key, { id: a.id, blocoApto, visitas: 1 });
      }
    }

    return {
      visitante: {
        id: v.id,
        nome: v.nome,
        doc_identificacao: v.doc_identificacao,
        foto_pessoa: v.foto_pessoa,
        foto_documento: v.foto_documento,
        is_visitante: v.is_visitante,
        is_prestador: v.is_prestador,
        id_apartamento: v.id_apartamento,
        blocoAptoAtual: v.apartamento
          ? `${v.apartamento.apto ?? ''}${v.apartamento.bloco ?? ''}`.trim()
          : null,
        face_id: v.face_id,
        face_sync_status: v.face_sync_status,
        condominio: v.condominio?.nome ?? null,
        criadoPor: v.criadoPor?.name ?? null,
        data_hora_inicio: v.data_hora_inicio?.toISOString() ?? null,
        data_hora_termino: v.data_hora_termino?.toISOString() ?? null,
        codigo_acesso: v.codigo_acesso,
        data_entrada: v.data_entrada?.toISOString() ?? null,
        data_saida: v.data_saida?.toISOString() ?? null,
        created_at: v.created_at.toISOString(),
      },
      stats: {
        totalEntradas,
        totalSaidas,
        totalNegados,
        primeiraVisita: primeira,
        ultimaVisita: ultima,
        acessosFaciais,
        acessosPin,
        tempoMedioMs,
        permanenciaCount,
        apartamentosVisitados: Array.from(apartamentosVisitados.values()),
      },
      timeline,
    };
  }

  async checkIn(id: number) {
    const v = await this.prisma.visitantes.update({
      where: { id: Number(id) },
      data: { data_entrada: new Date(), data_saida: null, liberado: 1 },
    });
    const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
    const ctx = await this.carregarContextoVisitante(v.id);
    const aptoLabel = ctx?.apartamento?.label ?? '—';
    await this.auditoria.registrar({
      id_condominio: v.id_condominio,
      usuario_nome: 'Portaria / Sistema',
      acao: 'CHECK_IN',
      modulo: 'visitantes',
      entidade_id: v.id,
      descricao: `Check-in de ${label} "${v.nome}" no ${aptoLabel}`,
      detalhes: ctx ?? undefined,
    });
    return { ok: true };
  }

  async liberarAcesso(id: number) {
    const v = await this.prisma.visitantes.update({
      where: { id: Number(id) },
      data: { liberado: 1, data_entrada: null, data_saida: null },
    });
    const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
    const ctx = await this.carregarContextoVisitante(v.id);
    const aptoLabel = ctx?.apartamento?.label ?? '—';
    await this.auditoria.registrar({
      id_condominio: v.id_condominio,
      usuario_nome: 'Portaria / Morador',
      acao: 'UPDATE',
      modulo: 'visitantes',
      entidade_id: v.id,
      descricao: `Acesso liberado: ${label} "${v.nome}" no ${aptoLabel}`,
      detalhes: ctx ?? undefined,
    });
    await this.desativarOutrosCodigos(v.id_condominio, v.id, v.nome, v.doc_identificacao);
    return { ok: true };
  }

  async checkOut(id: number) {
    const v = await this.prisma.visitantes.update({
      where: { id: Number(id) },
      data: { data_saida: new Date(), codigo_acesso: null, liberado: 0 },
    });
    const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
    const ctx = await this.carregarContextoVisitante(v.id);
    const aptoLabel = ctx?.apartamento?.label ?? '—';
    await this.auditoria.registrar({
      id_condominio: v.id_condominio,
      usuario_nome: 'Portaria / Sistema',
      acao: 'CHECK_OUT',
      modulo: 'visitantes',
      entidade_id: v.id,
      descricao: `Check-out de ${label} "${v.nome}" do ${aptoLabel}`,
      detalhes: ctx ?? undefined,
    });
    return { ok: true };
  }

  async findAllMobile(
    idCondominio?: number,
    idApto?: number,
    search?: string,
    offset = 0,
    userId?: number,
    userType?: string,
  ) {
    const conditions: any[] = [];

    if (idCondominio) {
      conditions.push({ id_condominio: Number(idCondominio) });
      if (idApto) {
        conditions.push({ id_apartamento: Number(idApto) });
      }
    } else if (userId && userType) {
      const typeLower = userType.toLowerCase();
      if (typeLower === 'morador') {
        conditions.push({
          OR: [
            {
              apartamento: {
                users: {
                  some: {
                    id_user: userId,
                  },
                },
              },
            },
            {
              user: userId,
            },
          ],
        });
      } else if (typeLower === 'sindico') {
        const managed = await this.prisma.sindicos_Condominios.findMany({
          where: { id_user: userId },
          select: { id_condominio: true },
        });
        const condoIds = managed.map((m) => m.id_condominio);
        conditions.push({
          id_condominio: { in: condoIds },
        });
      } else if (typeLower === 'funcionario') {
        const func = await this.prisma.funcionarios.findFirst({
          where: { id_user: userId },
          select: { id_condominio: true },
        });
        if (func) {
          conditions.push({
            id_condominio: func.id_condominio,
          });
        } else {
          return [];
        }
      }
    } else {
      return [];
    }

    if (search) {
      conditions.push({
        OR: [
          { nome: { contains: search } },
          { doc_identificacao: { contains: search } },
        ],
      });
    }

    const whereClause = conditions.length > 0 ? { AND: conditions } : {};

    const list = await this.prisma.visitantes.findMany({
      where: whereClause,
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        condominio: { select: { nome: true } },
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
      take: 30,
      skip: offset,
    });

    // Auto-gerar PIN para visitantes sem código e que ainda não saíram
    const updated: any[] = [];
    for (const v of list) {
      if (!v.codigo_acesso && !v.data_saida) {
        const pin = await this.gerarPinUnico();
        const novo = await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { codigo_acesso: pin },
          include: { 
            apartamento: { select: { bloco: true, apto: true } },
            condominio: { select: { nome: true } },
          },
        });
        updated.push(novo);
      } else {
        updated.push(v);
      }
    }

    return updated.map((v: any) => ({
      ...v,
      condominio_nome: v.condominio?.nome || null,
    }));
  }

  private async desativarOutrosCodigos(
    idCondominio: number,
    idAtual: number,
    nome: string,
    doc?: string | null,
  ): Promise<void> {
    if (!this.prisma.isConnected) return;
    const docNorm = doc?.trim();
    const where: any = {
      id_condominio: Number(idCondominio),
      id: { not: Number(idAtual) },
      data_entrada: null,
      data_saida: null,
    };
    if (docNorm) {
      where.doc_identificacao = docNorm;
    } else {
      where.nome = nome.trim();
      where.doc_identificacao = null;
    }

    await this.prisma.visitantes.updateMany({
      where,
      data: {
        liberado: 0,
        codigo_acesso: null,
      },
    });
  }

  private async gerarPinUnico(): Promise<string> {
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await this.prisma.visitantes.findFirst({
        where: { codigo_acesso: pin, data_saida: null },
      });
      if (!check) isUnique = true;
    }
    return pin;
  }
}