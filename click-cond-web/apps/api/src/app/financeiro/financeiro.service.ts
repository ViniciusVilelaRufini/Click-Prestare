import { Injectable, NotFoundException, OnModuleInit, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MailService } from '../common/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertSameTenant } from '../auth/tenant.util';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FechamentoService } from './fechamento.service';
import { OpenPixService } from './openpix.service';

@Injectable()
export class FinanceiroService implements OnModuleInit {
  private readonly logger = new Logger(FinanceiroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly auditoria: AuditoriaService,
    private readonly fechamento: FechamentoService,
    private readonly openPix: OpenPixService,
  ) {}

  // Lock para impedir execução concorrente do job (se o intervalo se sobrepuser
  // a uma execução lenta, ou se Nest emitir múltiplos onModuleInit em algum caso edge).
  private billingJobRunning = false;

  // Dedup em memória para evitar reenvio de lembrete no mesmo dia.
  // Key: `${faturaId}:${tipo}:${YYYY-MM-DD}`. Reseta no reboot.
  // Sem isso, reiniciar o backend = todos os moradores recebem push de novo
  // das mesmas faturas (UX horrível, motivo de desinstalar o app).
  private lembretesEnviados = new Set<string>();

  onModuleInit() {
    // 1h após startup roda a primeira vez (não 30s — evita rodar durante o
    // warm-up se Railway ainda está terminando deploy). Depois checa a cada
    // hora se está dentro da janela horária permitida (9h-18h por padrão).
    setTimeout(() => this.tickBillingJob(), 60 * 60 * 1000);
    setInterval(() => this.tickBillingJob(), 60 * 60 * 1000);
  }

  /**
   * Tick horário do job. Só executa se:
   *   1. Não há outra execução em curso (lock simples)
   *   2. Está dentro da janela horária (env BILLING_REMINDER_HOUR_START/END)
   *   3. É exatamente a "hora gatilho" (default 9h) — evita rodar 10x por dia
   *
   * É melhor que setInterval(24h) porque sobrevive a reinícios sem perder a
   * janela do dia, e nunca dispara push fora do horário comercial.
   */
  private async tickBillingJob() {
    if (this.billingJobRunning) {
      this.logger.debug('Job de lembretes já em execução — pulando este tick');
      return;
    }

    const triggerHour = Number(process.env.BILLING_REMINDER_HOUR ?? 9);
    // Hora local do servidor. Railway por padrão está em UTC — operador deve
    // configurar TZ=America/Sao_Paulo ou ajustar BILLING_REMINDER_HOUR pra
    // compensar (ex: 12 = 9h em SP quando server está em UTC).
    const horaAtual = new Date().getHours();
    if (horaAtual !== triggerHour) {
      return;
    }

    // Limpa cache de dedup mais antigo que 3 dias (em produção longa, evita
    // o Set crescer indefinidamente).
    this.purgarCacheLembretesAntigos();

    this.billingJobRunning = true;
    try {
      await this.runBillingRemindersJob();
      await this.runRecurringBillingJob();
      await this.runAutoWhatsAppDunningJob();
    } catch (err: any) {
      this.logger.error(`Job de lembretes falhou: ${err?.message ?? err}`);
    } finally {
      this.billingJobRunning = false;
    }
  }

  private purgarCacheLembretesAntigos() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const k of this.lembretesEnviados) {
      const datePart = k.split(':')[2];
      if (datePart && datePart < cutoffStr) {
        this.lembretesEnviados.delete(k);
      }
    }
  }

  /**
   * Carrega um lançamento e valida que pertence ao condomínio do operador.
   *
   * Sem isso, qualquer síndico/porteiro autenticado consegue ler, editar
   * ou apagar lançamentos de OUTROS condomínios passando o id solto.
   * É o vetor mais crítico do módulo financeiro — mexe em fluxo de caixa.
   */
  /**
   * Parser unificado de data brasileira / ISO.
   *
   * Aceita:
   *   - "dd/mm/aaaa"  → interpretação local (BR)
   *   - "aaaa-mm-dd" e ISO   → delegado pro construtor Date
   *   - "" / null / undefined → null
   *
   * Retorna `null` se a data resultante for inválida (NaN). Antes esse
   * parser estava duplicado em 5 lugares, e em 2 deles sem a checagem
   * de NaN — datas inválidas iam pro banco como "Invalid Date" e
   * estouravam depois no toLocaleDateString.
   */
  /**
   * Verifica se o nome de um lançamento bate exatamente com um apartamento.
   *
   * Lançamentos de cobrança seguem o padrão "Apto X Bloco Y - Ref. MM/AAAA"
   * (ou "Apto X Bloco Y - Rateio: ..." / "- Acordo Parc."). Esse helper
   * garante MATCH EXATO de número de apto e bloco, em vez de substring.
   *
   * Antes: `nome.includes('Apto 10')` casava com Apto 10, 100, 101, 1010 →
   * VAZAMENTO de dados financeiros entre apartamentos.
   *
   * Agora: regex com word boundaries. "Apto 10 Bloco A" NÃO casa com
   * "Apto 100 Bloco A".
   */
  private nomeFaturaDeApto(nome: string | null | undefined, apto: string | null | undefined, bloco: string | null | undefined): boolean {
    if (!nome || !apto) return false;
    // Escapa caracteres regex no apto/bloco (defensivo — apto pode ter
    // hífen ou outros símbolos em alguns condomínios).
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aptoEsc = escape(apto.trim());

    // Apartamento precisa estar entre "Apto " e fronteira de palavra (espaço,
    // fim de string, ou pontuação).
    const aptoRegex = new RegExp(`\\bApto\\s+${aptoEsc}\\b`, 'i');
    if (!aptoRegex.test(nome)) return false;

    // Se bloco informado, valida também. Se vazio/null, aceita lançamento
    // sem bloco (apartamento sem bloco em condomínios pequenos).
    const blocoNorm = bloco?.trim() ?? '';
    if (blocoNorm) {
      const blocoEsc = escape(blocoNorm);
      const blocoRegex = new RegExp(`\\bBloco\\s+${blocoEsc}\\b`, 'i');
      return blocoRegex.test(nome);
    }
    // Sem bloco no perfil: aceita só se o nome também não tiver bloco
    // ("Apto 5 - Ref. 03/2026" sem "Bloco").
    return !/\bBloco\s+\S/i.test(nome);
  }

  private parseDataBR(dStr?: string | null): Date | null {
    if (!dStr) return null;
    let d: Date;
    if (dStr.includes('/')) {
      const parts = dStr.split('/');
      if (parts.length !== 3) return null;
      const dia = Number(parts[0]);
      const mes = Number(parts[1]);
      const ano = Number(parts[2]);
      if (Number.isNaN(dia) || Number.isNaN(mes) || Number.isNaN(ano)) return null;
      d = new Date(ano, mes - 1, dia);
    } else {
      d = new Date(dStr);
    }
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async getLancamentoForTenant(id: number, user?: JwtPayload) {
    const lanc = await this.prisma.financeiro.findUnique({
      where: { id: Number(id) },
      select: { id: true, id_condominio: true, nome: true, valor: true, tipo: true, pago: true, status: true, id_usuario: true },
    });
    if (!lanc) throw new NotFoundException(`Lançamento ${id} não encontrado`);
    assertSameTenant(lanc.id_condominio, user, `lançamento #${id}`);
    return lanc;
  }

  /**
   * Contexto rico de um lançamento financeiro para auditoria. Responde
   * "qual lançamento, valor, vencimento, categoria, ligado a quem, pago?".
   *
   * Esse módulo movimenta dinheiro — sem rastro detalhado, fraude interna
   * fica impune ("quem marcou X como pago às 23h?").
   */
  private async carregarContextoLancamento(idLanc: number) {
    const l = await this.prisma.financeiro.findUnique({ where: { id: idLanc } });
    if (!l) return null;

    const formatReal = (n: number) =>
      n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleDateString('pt-BR') : null;

    const valor = l.valor ? Number(l.valor) : 0;

    return {
      lancamento: {
        id: l.id,
        nome: l.nome,
        tipo: l.tipo === 'D' ? 'Despesa' : 'Receita',
        valor,
        valorFormatado: formatReal(Math.abs(valor)),
        categoria: l.categoria,
        conta: l.conta,
        descricao: l.descricao,
        formaPagamento: l.forma_pagamento,
      },
      datas: {
        lancamento: fmtDate(l.data),
        vencimento: fmtDate(l.data_vencimento),
      },
      status: {
        pago: l.pago === 1,
        codigoStatus: l.status,
        temBoleto: !!l.url_boleto,
        temComprovante: !!l.photo,
        temLinhaDigitavel: !!l.linha_digitavel,
        temPix: !!l.pix_copia_cola,
      },
      vinculo: {
        idUsuario: l.id_usuario,
        cliente: l.cliente,
        operadorRegistro: l.nome_operador,
      },
    };
  }

  // ==========================================
  // CRUD PRINCIPAL
  // ==========================================
  async insert(idCondominio: number, financeiro: any, operatorName: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida: id_condominio do body bate com JWT do operador.
    assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);

    // Bloqueia inserção em mês fechado. Checagem feita já com a data
    // parseada para reaproveitar o helper, abaixo após o parsing.

    let valor = 0;
    if (typeof financeiro.valor === 'number') {
      valor = financeiro.valor;
    } else {
      let str = String(financeiro.valor || '0').replace('R$', '').trim();
      if (str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      }
      valor = parseFloat(str);
    }
    if (isNaN(valor)) valor = 0;

    const absValor = Math.abs(valor);
    if (absValor <= 0 || absValor > 9999999) {
      throw new BadRequestException('O valor do lançamento deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

    valor = financeiro.tipo === 'D' ? -absValor : absValor;

    let photoUrl = financeiro.photo ?? '';
    if (this.storage.isDataUrl(photoUrl)) {
      const uploaded = await this.storage.uploadDataUrl(photoUrl, 'financeiro');
      photoUrl = uploaded ?? '';
    }

    const dLanc = this.parseDataBR(financeiro.data);
    const dVenc = this.parseDataBR(financeiro.data_vencimento);

    // Bloqueia insert em mês fechado.
    await this.fechamento.assertPodeAlterar(
      Number(idCondominio),
      dLanc ?? dVenc,
      'insert',
      financeiro.nome,
    );

    let isPago = 0;
    if (financeiro.pago !== undefined && financeiro.pago !== null) {
      isPago = Number(financeiro.pago) === 1 ? 1 : 0;
    } else {
      const isMoradorCharge = (financeiro.nome && financeiro.nome.startsWith('Apto ')) || financeiro.categoria === 'Arrecadação';
      if (financeiro.data && financeiro.data !== '' && !isMoradorCharge) {
        isPago = 1;
      }
    }

    let idUsuario = financeiro.id_usuario ? Number(financeiro.id_usuario) : null;
    if (!idUsuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
      const match = financeiro.nome.match(regex);
      if (match) {
        const apto = match[1];
        const bloco = match[2];
        const morador = await this.prisma.moradores.findFirst({
          where: {
            id_condominio: Number(idCondominio),
            apartamento: apto,
            bloco: bloco,
          },
          select: { id_user: true },
        });
        if (morador) {
          idUsuario = morador.id_user;
        }
      }
    }

    // Normaliza tipos: o app Flutter manda parcelas/status como int, mas o
    // schema espera string (varchar). Esse mismatch pode estourar no Prisma
    // de formas inesperadas em produção (TypeError JS engine "Must call super
    // constructor..." foi reportado quando o decimal/string handling falhava).
    const parcelasStr = financeiro.parcelas == null
      ? null
      : String(financeiro.parcelas);
    const statusStr = financeiro.status == null
      ? '0'
      : String(financeiro.status);

    let criado;
    try {
      criado = await this.prisma.financeiro.create({
        data: {
          nome: financeiro.nome || 'Lançamento sem nome',
          tipo: financeiro.tipo || 'C',
          valor,
          data: dLanc,
          data_vencimento: dVenc,
          categoria: financeiro.categoria ?? 'Geral',
          conta: financeiro.conta ?? null,
          descricao: financeiro.descricao ?? null,
          cliente: financeiro.cliente ?? null,
          forma_pagamento: financeiro.forma_pagamento ?? null,
          parcelas: parcelasStr,
          nome_operador: operatorName,
          id_condominio: Number(idCondominio),
          photo: photoUrl,
          pago: isPago,
          url_boleto: financeiro.url_boleto ?? null,
          status: statusStr,
          linha_digitavel: financeiro.linha_digitavel ?? null,
          pix_copia_cola: financeiro.pix_copia_cola ?? null,
          id_usuario: idUsuario,
        },
      });

      // Automatically generate OpenPix charge for unpaid Receitas
      if (criado.tipo === 'C' && criado.pago === 0 && !criado.pix_copia_cola) {
        const pixData = await this.openPix.generateCharge(
          `financeiro_${criado.id}`,
          Math.abs(criado.valor ? Number(criado.valor) : 0),
          criado.nome ?? 'Cobrança',
        );
        if (pixData?.brCode) {
          criado = await this.prisma.financeiro.update({
            where: { id: criado.id },
            data: { pix_copia_cola: pixData.brCode },
          });
        }
      }
    } catch (err: any) {
      // Loga com stack pra diagnostico (Railway logs)
      this.logger.error(
        `[financeiro.insert] Falha ao criar lancamento: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel salvar o lancamento. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Auditoria nao deve quebrar o insert se algo falhar nela.
    try {
      const ctx = await this.carregarContextoLancamento(criado.id);
      const tipoLabel = criado.tipo === 'D' ? 'Despesa' : 'Receita';
      await this.auditoria.registrar({
        id_condominio: Number(idCondominio),
        usuario_nome: operatorName,
        acao: 'CREATE',
        modulo: 'financeiro',
        entidade_id: criado.id,
        descricao: `Lançou ${tipoLabel}: ${criado.nome} — ${ctx?.lancamento.valorFormatado}`,
        detalhes: ctx ?? undefined,
      });
    } catch (err: any) {
      this.logger.warn(
        `[financeiro.insert] Falha na auditoria (lancamento ja foi criado): ${err?.message ?? err}`,
      );
    }

    return { success: true };
  }

  async update(idCondominio: number, financeiro: any, operatorName: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida: id_condominio do body bate com JWT, e lançamento existe nesse condomínio.
    assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    if (financeiro?.id) {
      await this.getLancamentoForTenant(Number(financeiro.id), user);
    }

    let valor = 0;
    if (typeof financeiro.valor === 'number') {
      valor = financeiro.valor;
    } else {
      let str = String(financeiro.valor || '0').replace('R$', '').trim();
      if (str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      }
      valor = parseFloat(str);
    }
    if (isNaN(valor)) valor = 0;

    const absValor = Math.abs(valor);
    if (absValor <= 0 || absValor > 9999999) {
      throw new BadRequestException('O valor do lançamento deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

    valor = financeiro.tipo === 'D' ? -absValor : absValor;

    let photoUrl = financeiro.photo ?? undefined;
    if (this.storage.isDataUrl(photoUrl)) {
      const uploaded = await this.storage.uploadDataUrl(photoUrl, 'financeiro');
      photoUrl = uploaded ?? undefined;
    }

    const dLanc = this.parseDataBR(financeiro.data);
    const dVenc = this.parseDataBR(financeiro.data_vencimento);

    // Bloqueia update se a competência ATUAL ou a NOVA está fechada. Sem
    // checar a competência atual, operador poderia mover lançamento pra
    // fora do mês fechado e depois editar.
    const lancAtual = financeiro?.id
      ? await this.prisma.financeiro.findUnique({
          where: { id: Number(financeiro.id) },
          select: { data: true, data_vencimento: true, nome: true },
        })
      : null;
    if (lancAtual) {
      await this.fechamento.assertPodeAlterar(
        Number(idCondominio),
        lancAtual.data ?? lancAtual.data_vencimento,
        'update',
        lancAtual.nome,
      );
    }
    await this.fechamento.assertPodeAlterar(
      Number(idCondominio),
      dLanc ?? dVenc,
      'update',
      financeiro.nome,
    );

    let isPago = 0;
    if (financeiro.pago !== undefined && financeiro.pago !== null) {
      isPago = Number(financeiro.pago) === 1 ? 1 : 0;
    } else {
      const isMoradorCharge = (financeiro.nome && financeiro.nome.startsWith('Apto ')) || financeiro.categoria === 'Arrecadação';
      if (financeiro.data && financeiro.data !== '' && !isMoradorCharge) {
        isPago = 1;
      }
    }

    let idUsuario = financeiro.id_usuario ? Number(financeiro.id_usuario) : null;
    if (!idUsuario && financeiro.nome && financeiro.nome.startsWith('Apto ')) {
      const regex = /Apto\s+([^\s]+)\s+Bloco\s+([^\s]+)/i;
      const match = financeiro.nome.match(regex);
      if (match) {
        const apto = match[1];
        const bloco = match[2];
        const morador = await this.prisma.moradores.findFirst({
          where: {
            id_condominio: Number(idCondominio),
            apartamento: apto,
            bloco: bloco,
          },
          select: { id_user: true },
        });
        if (morador) {
          idUsuario = morador.id_user;
        }
      }
    }

    // Carrega estado anterior pra computar diff antes do update.
    const antes = await this.prisma.financeiro.findUnique({
      where: { id: Number(financeiro.id) },
    });

    // Mesma normalizacao do insert: parcelas eh varchar no schema.
    const parcelasStr = financeiro.parcelas == null
      ? null
      : String(financeiro.parcelas);

    try {
      await this.prisma.financeiro.updateMany({
        where: {
          id: Number(financeiro.id),
          id_condominio: Number(idCondominio),
        },
        data: {
          nome: financeiro.nome,
          tipo: financeiro.tipo,
          valor,
          data: dLanc,
          pago: isPago,
          ...(dVenc !== null ? { data_vencimento: dVenc } : {}),
          categoria: financeiro.categoria,
          conta: financeiro.conta,
          descricao: financeiro.descricao,
          cliente: financeiro.cliente,
          forma_pagamento: financeiro.forma_pagamento,
          parcelas: parcelasStr,
          nome_operador: operatorName,
          ...(photoUrl !== undefined ? { photo: photoUrl } : {}),
          ...(financeiro.status !== undefined ? { status: String(financeiro.status) } : {}),
          ...(financeiro.linha_digitavel !== undefined ? { linha_digitavel: financeiro.linha_digitavel } : {}),
          ...(financeiro.pix_copia_cola !== undefined ? { pix_copia_cola: financeiro.pix_copia_cola } : {}),
          id_usuario: idUsuario,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[financeiro.update] Falha ao atualizar lancamento: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel salvar as alteracoes. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Diff dos campos sensíveis. Valor e pago são os mais críticos: mudar
    // valor é mudar quanto entra/sai; mudar pago é declarar pagamento.
    const depois = await this.prisma.financeiro.findUnique({ where: { id: Number(financeiro.id) } });
    const camposAuditar = ['nome', 'tipo', 'valor', 'categoria', 'pago', 'status', 'data', 'data_vencimento'] as const;
    const changes: Record<string, { de: any; para: any }> = {};
    if (antes && depois) {
      for (const k of camposAuditar) {
        const v1 = (antes as any)[k];
        const v2 = (depois as any)[k];
        const v1Norm = v1 instanceof Date ? v1.toISOString() : v1 != null ? String(v1) : null;
        const v2Norm = v2 instanceof Date ? v2.toISOString() : v2 != null ? String(v2) : null;
        if (v1Norm !== v2Norm) {
          changes[k] = { de: v1Norm, para: v2Norm };
        }
      }
    }
    const ctx = await this.carregarContextoLancamento(Number(financeiro.id));
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'UPDATE',
      modulo: 'financeiro',
      entidade_id: Number(financeiro.id),
      descricao: `Editou lançamento: ${financeiro.nome ?? '(sem nome)'} — ${ctx?.lancamento.valorFormatado ?? ''}`,
      detalhes: { contexto: ctx, changes },
    });

    return { success: true };
  }

  async remove(id: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };
    // Garante que o lançamento pertence ao condomínio do operador.
    const lanc = await this.getLancamentoForTenant(id, user);

    // Bloqueia remoção em mês fechado.
    const lancCompleto = await this.prisma.financeiro.findUnique({
      where: { id: Number(id) },
      select: { data: true, data_vencimento: true },
    });
    await this.fechamento.assertPodeAlterar(
      lanc.id_condominio,
      lancCompleto?.data ?? lancCompleto?.data_vencimento ?? null,
      'delete',
      lanc.nome,
    );

    // Carrega contexto rico antes de remover (depois não existe mais).
    const ctx = await this.carregarContextoLancamento(id);
    await this.prisma.financeiro.delete({ where: { id: Number(id) } });

    await this.auditoria.registrar({
      id_condominio: lanc.id_condominio,
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'DELETE',
      modulo: 'financeiro',
      entidade_id: id,
      descricao: `Removeu lançamento: ${lanc.nome ?? '(sem nome)'} — ${ctx?.lancamento.valorFormatado ?? ''}`,
      detalhes: ctx ?? undefined,
    });

    return { success: true };
  }

  async get(idCondominio: number, id: number, user: any) {
    if (!this.prisma.isConnected) {
      return {
        id, nome: 'Taxa Condominial', tipo: 'C', valor: 650.0,
        data_vencimento: '10/05/2026', data: '10/05/2026',
        categoria: 'Taxa Condominial', pago: 1, id_usuario: null,
      };
    }

    // Validação de tenant: para porteiro/síndico tradicional, o JWT carrega
    // id_condominio e precisa bater. Moradores no app não tem id_condominio
    // no JWT — para eles a validação adicional vem abaixo (só vê o próprio).
    const jwtPayload: JwtPayload | undefined = user?.id_condominio ? user : undefined;
    if (jwtPayload) {
      assertSameTenant(idCondominio, jwtPayload, `condomínio ${idCondominio}`);
    }

    const result = await this.prisma.financeiro.findFirst({
      where: { id: Number(id), id_condominio: Number(idCondominio) },
    });

    if (!result) throw new NotFoundException('Lançamento não encontrado.');

    // Morador só pode ver lançamentos vinculados a ele OU cobranças do seu apto.
    // Sem isso, morador chuta IDs e lê dados financeiros de qualquer um.
    const isMorador = user?.typeAccess === 'Morador';
    if (isMorador) {
      const userId = user?.id ?? user?.sub;
      const podeVer = result.id_usuario === userId;
      if (!podeVer && result.nome) {
        // Para faturas de apto (nome "Apto X Bloco Y - Ref. ..."), verifica se o
        // morador realmente mora nesse apto. Match por id_user em Moradores.
        const moradorMatch = await this.prisma.moradores.findFirst({
          where: {
            id_user: userId,
            id_condominio: Number(idCondominio),
          },
          select: { apartamento: true, bloco: true },
        });
        if (moradorMatch) {
          // Match exato — sem isso, morador de "Apto 10" lia faturas de
          // "Apto 100/101/1010" no mesmo bloco.
          if (!this.nomeFaturaDeApto(result.nome, moradorMatch.apartamento, moradorMatch.bloco)) {
            throw new ForbiddenException('Acesso negado: lançamento não pertence a você');
          }
        } else {
          throw new ForbiddenException('Acesso negado: lançamento não pertence a você');
        }
      } else if (!podeVer) {
        throw new ForbiddenException('Acesso negado: lançamento não pertence a você');
      }
    }

    const fmt = (d?: Date | null) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    return {
      id: result.id,
      nome: result.nome,
      tipo: result.tipo,
      valor: result.valor ? Number(result.valor) : 0,
      data_vencimento: fmt(result.data_vencimento),
      data: fmt(result.data),
      categoria: result.categoria,
      conta: result.conta,
      descricao: result.descricao,
      cliente: result.cliente,
      forma_pagamento: result.forma_pagamento,
      parcelas: result.parcelas,
      photo: result.photo,
      pago: result.pago,
      linha_digitavel: result.linha_digitavel,
      pix_copia_cola: result.pix_copia_cola,
    };
  }

  // ==========================================
  // LISTAGEM E AGRUPAMENTO GERAL
  // ==========================================
  async getAll(idCondominio: number, mesStr?: string, anoStr?: string, isSindico: boolean = true, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return {
        lancamentos: {
          '10 de Maio de 2026': [
            { id: 1, nome: 'Taxa Condominial Apto 101', tipo: 'C', valorString: 'R$ 650,00', valor: 650, pago: 1, categoria: 'Receitas', status: '1' },
            { id: 2, nome: 'Manutenção de Elevadores', tipo: 'D', valorString: '-R$ 1.200,00', valor: -1200, pago: 1, categoria: 'Despesas', status: '1' },
          ],
        },
        saldo: 'R$ 12.500,00',
        totalReceita: 'R$ 18.000,00',
        totalDespesa: 'R$ 5.500,00',
        dia: '14/05/2026',
        meses: [{ mes: '05', ano: '2026', periodo: 'Maio/2026' }],
      };
    }

    // Identificar meses disponíveis
    const mesesDisponiveis = await this.getAllMeses(idCondominio);

    let mes = mesStr ? Number(mesStr) : 5;
    let ano = anoStr ? Number(anoStr) : 2026;

    if (mesesDisponiveis.length > 0 && (!mesStr || !anoStr)) {
      const ult = mesesDisponiveis[mesesDisponiveis.length - 1];
      mes = Number(ult.mes);
      ano = Number(ult.ano);
    }

    // Montar intervalo
    const dataIni = new Date(ano, mes - 1, 1);
    const dataFim = new Date(ano, mes, 0); // último dia do mês

    const whereClause: any = {
      id_condominio: Number(idCondominio),
      OR: [
        { data: { gte: dataIni, lte: dataFim } },
        { data_vencimento: { gte: dataIni, lte: dataFim } },
      ],
    };

    if (!isSindico) {
      whereClause.pago = 1;
    }

    const list = await this.prisma.financeiro.findMany({
      where: whereClause,
      orderBy: [{ data: 'asc' }, { data_vencimento: 'asc' }],
    });

    const lancamentosMap: Record<string, any[]> = {};
    let saldo = 0;
    let totalReceita = 0;
    let totalDespesa = 0;
    let ultimoDiaFmt = `01/${mes < 10 ? '0' + mes : mes}/${ano}`;

    const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    for (const item of list) {
      let v = item.valor ? Number(item.valor) : 0;
      if (item.tipo === 'D') {
        v = -Math.abs(v);
      } else {
        v = Math.abs(v);
      }

      if (item.pago === 1) {
        saldo += v;
        if (item.tipo === 'C') totalReceita += Math.abs(v);
        else totalDespesa += Math.abs(v);
      }

      const refDate = item.data || item.data_vencimento || item.created_at;
      const d = refDate.getDate();
      const m = refDate.getMonth();
      const y = refDate.getFullYear();

      const chave = `${d} de ${mesesNomes[m]} de ${y}`;
      ultimoDiaFmt = `${d < 10 ? '0' + d : d}/${m + 1 < 10 ? '0' + (m + 1) : m + 1}/${y}`;

      const formatReal = (num: number) => {
        return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      };

      const formatado = {
        id: item.id,
        nome: item.nome,
        tipo: item.tipo,
        valor: v,
        valorString: formatReal(v),
        valorReal: formatReal(v),
        data_vencimento: item.data_vencimento ? item.data_vencimento.toLocaleDateString('pt-BR') : '',
        data: item.data ? item.data.toLocaleDateString('pt-BR') : '',
        saldoString: formatReal(saldo),
        categoria: item.categoria,
        nome_operador: item.nome_operador,
        pago: item.pago,
        status: item.status,
        url_boleto: item.url_boleto,
        url_comprovante: item.photo,
        linha_digitavel: item.linha_digitavel,
        pix_copia_cola: item.pix_copia_cola,
      };

      if (!lancamentosMap[chave]) {
        lancamentosMap[chave] = [];
      }
      lancamentosMap[chave].push(formatado);
    }

    const formatRealGeral = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return {
      lancamentos: lancamentosMap,
      saldo: formatRealGeral(saldo),
      totalReceita: formatRealGeral(totalReceita),
      totalDespesa: formatRealGeral(-totalDespesa),
      dia: ultimoDiaFmt,
      meses: mesesDisponiveis,
    };
  }

  // ==========================================
  // INADIMPLÊNCIA E TAXAS DE MORADORES
  // ==========================================
  async getAllMoradores(idCondominio: number, mesStr: string, anoStr: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) return { meses: [], blocos: [] };

    const meses = await this.getAllMeses(idCondominio);
    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }],
    });

    const startOfMonth = new Date(Number(anoStr), Number(mesStr) - 1, 1);
    const endOfMonth = new Date(Number(anoStr), Number(mesStr), 0, 23, 59, 59, 999);

    const financeiroRecords = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        OR: [
          {
            nome: {
              contains: `- Ref. ${mesStr}/${anoStr}`
            }
          },
          {
            nome: {
              contains: `- Ref. ${mesStr}/${anoStr.slice(-2)}`
            }
          },
          {
            nome: {
              contains: `- Ref. ${parseInt(mesStr)}`
            }
          },
          {
            data_vencimento: {
              gte: startOfMonth,
              lte: endOfMonth,
            }
          },
          {
            data: {
              gte: startOfMonth,
              lte: endOfMonth,
            }
          }
        ]
      }
    });

    const blocosMap: Record<string, any[]> = {};
    const fmtDate = (d?: Date | null) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    for (const a of aptos) {
      const fin = financeiroRecords.find((f) => {
        if (!this.nomeFaturaDeApto(f.nome, a.apto, a.bloco)) return false;

        // Match by date
        if (f.data_vencimento) {
          const fDate = new Date(f.data_vencimento);
          const fMes = String(fDate.getUTCMonth() + 1).padStart(2, '0');
          const fAno = String(fDate.getUTCFullYear());
          if (fMes === mesStr && fAno === anoStr) return true;
        }
        if (f.data) {
          const fDate = new Date(f.data);
          const fMes = String(fDate.getUTCMonth() + 1).padStart(2, '0');
          const fAno = String(fDate.getUTCFullYear());
          if (fMes === mesStr && fAno === anoStr) return true;
        }

        // Match by name formats
        const matchName1 = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${mesStr}/${anoStr}`;
        const matchName2 = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${mesStr}/${anoStr.slice(-2)}`;
        const matchName3 = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${parseInt(mesStr)}`;
        const normNome = f.nome?.trim();
        return normNome === matchName1 || normNome === matchName2 || normNome === matchName3;
      }) ?? null;

      const val = fin?.valor ? Number(fin.valor) : 0;
      const fmt = val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const itemApto = {
        apto_id: a.id,
        bloco: a.bloco,
        apto: a.apto,
        valor: val,
        valorReal: fmt,
        financeiro_id: fin?.id ?? null,
        pago: fin?.pago ?? 0,
        data: fmtDate(fin?.data),
        data_vencimento: fmtDate(fin?.data_vencimento),
        conta: fin?.conta ?? '',
        descricao: fin?.descricao ?? '',
        categoria: fin?.categoria ?? 'Condomínio',
        linha_digitavel: fin?.linha_digitavel ?? '',
        pix_copia_cola: fin?.pix_copia_cola ?? '',
        url_boleto: fin?.url_boleto ?? '',
        mes: mesStr,
        ano: anoStr,
      };

      const blocoKey = a.bloco || 'Sem Bloco';
      if (!blocosMap[blocoKey]) {
        blocosMap[blocoKey] = [];
      }
      blocosMap[blocoKey].push(itemApto);
    }

    const listBlocos = Object.keys(blocosMap).map(b => {
      const listaAptos = blocosMap[b];
      const totBloco = listaAptos.reduce((acc, curr) => acc + curr.valor, 0);
      return {
        bloco: b,
        total: totBloco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        aptos: listaAptos,
      };
    });

    return { meses, blocos: listBlocos };
  }

  async getAllInadimplentes(idCondominio: number, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return {
        blocos: [
          {
            bloco: 'A',
            aptos: [{ bloco: 'A', apto: '102', qtd: 2 }, { bloco: 'A', apto: '204', qtd: 1 }],
          },
        ],
      };
    }

    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }],
    });

    const faturasPendentes = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        tipo: 'C', // Apenas Receitas (cobranças) pendentes
      },
      select: { nome: true },
    });

    const blocosMap: Record<string, any[]> = {};

    for (const a of aptos) {
      const minhasPendentes = faturasPendentes.filter((f) =>
        this.nomeFaturaDeApto(f.nome, a.apto, a.bloco)
      );

      const devendoCount = minhasPendentes.length;
      const blocoKey = a.bloco || 'Sem Bloco';
      if (devendoCount > 0) {
        if (!blocosMap[blocoKey]) blocosMap[blocoKey] = [];
        blocosMap[blocoKey].push({
          bloco: blocoKey,
          apto: a.apto,
          qtd: devendoCount,
        });
      }
    }

    const listBlocos = Object.keys(blocosMap).map(b => ({
      bloco: b,
      aptos: blocosMap[b],
    }));

    return { blocos: listBlocos };
  }

  async getInadimplenteDetail(idCondominio: number, apto: string, bloco: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return [
        {
          mes: '03',
          ano: '2026',
          periodo: 'Março/2026',
          valor: 650,
          valorString: 'R$ 650,00',
          nome: `Apto ${apto} Bloco ${bloco} - Ref. 03/2026`,
          data_vencimento: '10/03/2026',
          pago: 0
        },
        {
          mes: '04',
          ano: '2026',
          periodo: 'Abril/2026',
          valor: 650,
          valorString: 'R$ 650,00',
          nome: `Apto ${apto} Bloco ${bloco} - Ref. 04/2026`,
          data_vencimento: '10/04/2026',
          pago: 0
        }
      ];
    }

    const candidatas = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        tipo: 'C', // Apenas Receitas (cobranças) pendentes
      },
    });

    const minhas = candidatas.filter((f) =>
      this.nomeFaturaDeApto(f.nome, apto, bloco)
    );

    const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const faturasDevendo = minhas.map((f) => {
      const refDate = f.data_vencimento || f.data || f.created_at || new Date();
      const m = refDate.getMonth() + 1;
      const y = refDate.getFullYear();
      const mStr = m < 10 ? '0' + m : String(m);

      const val = f.valor ? Number(f.valor) : 0;

      return {
        mes: mStr,
        ano: String(y),
        periodo: `${mesesNomes[m - 1]}/${y}`,
        id: f.id,
        nome: f.nome,
        valor: val,
        valorString: val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        data_vencimento: f.data_vencimento ? f.data_vencimento.toLocaleDateString('pt-BR') : '',
        pago: 0,
      };
    });

    return faturasDevendo;
  }

  async notifyInadimplente(idCondominio: number, apto: string, bloco: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return { success: true, message: 'Simulado com sucesso (modo offline).' };
    }

    const pendingFaturas = await this.getInadimplenteDetail(idCondominio, apto, bloco);

    if (pendingFaturas.length === 0) {
      return { success: false, message: 'Nenhuma fatura em atraso encontrada.' };
    }

    const moradores = await this.prisma.users.findMany({
      where: {
        moradores: {
          some: {
            id_condominio: idCondominio,
            apartamento: apto,
            bloco: bloco,
          },
        },
      },
    });

    const totalDivida = pendingFaturas.reduce((acc, f) => acc + f.valor, 0);
    const totalFormatted = totalDivida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let sentPushCount = 0;
    let sentEmailCount = 0;

    for (const morador of moradores) {
      // 1. Enviar Push Notification
      if (morador.fcm_token) {
        try {
          await this.notifications.sendPushNotification(
            morador.fcm_token,
            'Lembrete de Inadimplência',
            `Constatamos ${pendingFaturas.length} fatura(s) pendente(s) para o Apto ${apto} Bloco ${bloco}, totalizando ${totalFormatted}. Regularize pelo App.`,
            { type: 'financeiro' },
          );
          sentPushCount++;
        } catch (err) {
          this.logger.error(`Erro ao enviar push notification para ${morador.name}: ${err}`);
        }
      }

      // 2. Enviar Email
      if (morador.email) {
        try {
          const maisAntiga = pendingFaturas[0];
          await this.mail.sendBillingReminder(
            morador.email,
            morador.name || 'Morador',
            pendingFaturas.length > 1 ? `${pendingFaturas.length} faturas pendentes (Acumulado)` : maisAntiga.nome,
            maisAntiga.data_vencimento,
            totalFormatted,
            maisAntiga.pix_copia_cola || undefined,
          );
          sentEmailCount++;
        } catch (err) {
          this.logger.error(`Erro ao enviar email para ${morador.email}: ${err}`);
        }
      }
    }

    return {
      success: true,
      totalFaturas: pendingFaturas.length,
      totalDivida,
      totalFormatted,
      moradoresNotificados: moradores.length,
      pushEnviados: sentPushCount,
      emailsEnviados: sentEmailCount,
    };
  }

  // ==========================================
  // GRÁFICOS E COMPARTILHAMENTO DE ARQUIVOS
  // ==========================================
  async getGrafico(idCondominio: number, mesStr: string, anoStr: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return {
        meses: [{ mes: '05', ano: '2026', periodo: 'Maio/2026' }],
        categorias: [
          { categoria: 'Taxas Condominiais', saldo: 15000, saldoReal: 'R$ 15.000,00', percentualString: '80.00%', tipo: 'C' },
          { categoria: 'Manutenção', saldo: -3000, saldoReal: '-R$ 3.000,00', percentualString: '20.00%', tipo: 'D' },
        ],
        totalReceitaReal: 'R$ 15.000,00',
        totalDespesaReal: '-R$ 3.000,00',
        saldoReal: 'R$ 12.000,00',
        percentualReceita: '83.33%',
        percentualDespesa: '16.67%',
      };
    }

    const meses = await this.getAllMeses(idCondominio);
    let mes = mesStr ? Number(mesStr) : 5;
    let ano = anoStr ? Number(anoStr) : 2026;

    if (meses.length > 0 && (!mesStr || !anoStr)) {
      const ult = meses[meses.length - 1];
      mes = Number(ult.mes);
      ano = Number(ult.ano);
    }

    const dataIni = new Date(ano, mes - 1, 1);
    const dataFim = new Date(ano, mes, 0);

    const list = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 1,
        OR: [
          { data: { gte: dataIni, lte: dataFim } },
          { data_vencimento: { gte: dataIni, lte: dataFim } },
        ],
      },
      orderBy: { categoria: 'asc' },
    });

    const categsMap: Record<string, { saldo: number; tipo: string }> = {};
    let totalReceita = 0;
    let totalDespesa = 0;
    let saldo = 0;

    for (const item of list) {
      // Use item.tipo from DB as the single source of truth — NOT the category name heuristic,
      // which breaks when a custom category like "Receitas" is stored as a Despesa (tipo='D').
      const itemTipo = item.tipo === 'C' ? 'C' : 'D';
      let v = Math.abs(item.valor ? Number(item.valor) : 0);

      if (itemTipo === 'D') {
        v = -v; // despesas always negative
      }

      const cat = item.categoria || 'Outros';

      // Group by category. If the same category name has mixed types (edge case),
      // the first transaction's tipo wins for the colour — values still accumulate correctly.
      if (!categsMap[cat]) {
        categsMap[cat] = { saldo: 0, tipo: itemTipo };
      }
      categsMap[cat].saldo += v;
      saldo += v;

      if (itemTipo === 'C') {
        totalReceita += Math.abs(v);
      } else {
        totalDespesa += Math.abs(v);
      }
    }

    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const listCategs = Object.keys(categsMap).map(c => {
      const info = categsMap[c];
      const isRevenue = info.tipo === 'C';
      const denominator = isRevenue ? totalReceita : totalDespesa;
      const perc = denominator > 0 ? (Math.abs(info.saldo) * 100) / denominator : 0;

      return {
        categoria: c,
        saldo: info.saldo,
        saldoReal: formatReal(info.saldo),
        tipo: info.tipo,
        percentual: Number(perc.toFixed(2)),
        percentualString: perc.toFixed(2) + '%',
      };
    });

    const baseCalc = totalReceita + totalDespesa;
    const percRec = baseCalc > 0 ? (totalReceita * 100) / baseCalc : 0;
    const percDes = baseCalc > 0 ? (totalDespesa * 100) / baseCalc : 0;

    return {
      meses,
      categorias: listCategs,
      totalReceitaReal: formatReal(totalReceita),
      totalDespesaReal: formatReal(-totalDespesa),
      saldoReal: formatReal(saldo),
      percentualReceita: percRec.toFixed(2) + '%',
      percentualDespesa: percDes.toFixed(2) + '%',
    };
  }

  async getByUser(idUser: number, idCondominio: number) {
    if (!this.prisma.isConnected) {
      return [
        {
          id: 1, nome: 'Taxa de Condomínio - Maio', tipo: 'C', valorReal: 'R$ 650,00',
          data_vencimento: '10/05/2026', data: '10/05/2026', pago: 1,
          url_boleto: 'https://example.com/boleto.pdf', url_comprovante: '', status: '1',
          id_usuario: null, categoria: 'Condomínio'
        },
      ];
    }

    // Busca os vínculos de apartamento do morador
    const moradoresList = await this.prisma.moradores.findMany({
      where: { id_user: Number(idUser) },
    });

    const list = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        OR: [
          { id_usuario: Number(idUser) },
          { tipo: 'C' }
        ]
      },
      orderBy: { data_vencimento: 'desc' },
    });

    const filteredList = list.filter(item => {
      // id_usuario pode ser number do Prisma vs number JS — usa Number() para garantir
      if (item.id_usuario != null && Number(item.id_usuario) === Number(idUser)) return true;
      if (item.tipo === 'C') {
        const match = moradoresList.some(m =>
          this.nomeFaturaDeApto(item.nome, m.apartamento, m.bloco)
        );
        if (!match) {
          this.logger.debug(`[getByUser] item ID=${item.id} nome="${item.nome}" NÃO bateu com nenhum apartamento do morador ${idUser} (${moradoresList.map(m => `${m.apartamento}/${m.bloco}`).join(', ')})`);
        }
        return match;
      }
      return false;
    });

    return filteredList.map(item => ({
      id: item.id,
      nome: item.nome,
      tipo: item.tipo,
      valor: item.valor ? Number(item.valor) : 0,
      valorReal: item.valor ? Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00',
      data_vencimento: item.data_vencimento ? item.data_vencimento.toLocaleDateString('pt-BR') : '',
      data: item.data ? item.data.toLocaleDateString('pt-BR') : '',
      pago: item.pago,
      url_boleto: item.url_boleto ?? '',
      url_comprovante: item.photo ?? '',
      status: item.status ?? '0',
      linha_digitavel: item.linha_digitavel ?? '',
      pix_copia_cola: item.pix_copia_cola ?? '',
      id_usuario: item.id_usuario,
      categoria: item.categoria ?? 'Outros',
    }));
  }

  async uploadSharedFile(id: number, fileBase64: string, type: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { url: '' };

    // Sem essa checagem, qualquer um anexa boleto/comprovante a lançamento alheio.
    const lanc = await this.getLancamentoForTenant(id, user);

    // Morador só pode anexar comprovante a lançamento dele próprio (id_usuario).
    const isMorador = user?.typeAccess === 'Morador';
    if (isMorador) {
      const userId = user?.sub;
      if (lanc.id_usuario && lanc.id_usuario !== userId) {
        throw new ForbiddenException('Você só pode anexar arquivo a um lançamento seu');
      }
    }

    const prefix = type === 'boleto' ? 'boletos' : 'comprovantes';

    // Se o base64 for enviado sem prefixo data URL (caso do FilePicker do Flutter), adiciona o prefixo
    let dataUrl = fileBase64;
    if (typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
      if (dataUrl.startsWith('JVBERi0')) {
        dataUrl = `data:application/pdf;base64,${dataUrl}`;
      } else {
        dataUrl = `data:image/png;base64,${dataUrl}`;
      }
    }

    let url: string | null = null;
    if (this.storage.enabled) {
      url = await this.storage.uploadDataUrl(dataUrl, prefix);
    } else {
      // Local development fallback
      this.logger.warn('StorageService desativado. Usando URL mockada para desenvolvimento local.');
      url = `https://dummyimage.com/600x400/3498db/ffffff&text=Comprovante+Local+ID+${id}`;
    }

    if (!url) {
      throw new NotFoundException('Falha ao subir arquivo (storage indisponível).');
    }

    try {
      if (type === 'boleto') {
        await this.prisma.financeiro.update({
          where: { id: Number(id) },
          data: { url_boleto: url },
        });
      } else {
        // comprovante, seta status = 2 (aguardando auditoria do sindico)
        await this.prisma.financeiro.update({
          where: { id: Number(id) },
          data: { photo: url, status: '2' },
        });
      }
    } catch (err: any) {
      this.logger.error(
        `[uploadSharedFile] Falha ao atualizar lancamento ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel anexar o arquivo. Tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    return { url };
  }

  async updateStatus(
    id: number,
    statusStr: string | number,
    user?: JwtPayload,
    extras?: { motivo?: string; formaPagamento?: string; identificadorComprovante?: string },
  ) {
    if (!this.prisma.isConnected) return { success: true };

    // Marcar despesa como paga é a mutação MAIS sensível do módulo financeiro.
    // Validação obrigatória: lançamento existe e pertence ao condomínio do operador.
    const lanc = await this.getLancamentoForTenant(id, user);

    // Carrega o lançamento completo (precisamos do nome_operador para checar
    // segregação de funções, e da data para checar fechamento).
    const lancCompleto = await this.prisma.financeiro.findUnique({
      where: { id: Number(id) },
      select: { nome_operador: true, data: true, data_vencimento: true },
    });

    // Bloqueia em mês fechado, EXCETO cobrança de morador (pagamento atrasado
    // de morador deve ser permitido mesmo após fechamento da competência).
    await this.fechamento.assertPodeAlterar(
      lanc.id_condominio,
      lancCompleto?.data ?? lancCompleto?.data_vencimento ?? null,
      'updateStatus',
      lanc.nome,
    );

    const status = String(statusStr);
    const isPago = status === '1' ? 1 : 0;
    const statusAnterior = lanc.status;
    const pagoAnterior = lanc.pago;

    // === Segregação de funções (soft) ===
    // Quando o operador marca como PAGO um lançamento que ele MESMO criou,
    // exigimos um motivo (justificativa) e a forma de pagamento. Não bloqueia
    // — só documenta. Cobre o caso comum: porteiro abre "Conta de luz" e
    // marca como paga porque o síndico pagou em dinheiro.
    //
    // Match por nome do operador (não temos id_operador no schema). Não é
    // perfeito (dois operadores com mesmo nome falham), mas é o que o schema
    // atual permite sem migration.
    const isAutoAprovacao =
      pagoAnterior !== isPago &&
      isPago === 1 &&
      user?.nome &&
      lancCompleto?.nome_operador &&
      user.nome.trim().toLowerCase() === lancCompleto.nome_operador.trim().toLowerCase();

    if (isAutoAprovacao) {
      const motivo = extras?.motivo?.trim();
      if (!motivo || motivo.length < 5) {
        throw new BadRequestException(
          'Para marcar como pago um lançamento que você mesmo criou, informe o motivo (ex: "Pago em dinheiro pelo morador", "PIX recebido na conta do síndico"). Mínimo 5 caracteres.',
        );
      }
      if (!extras?.formaPagamento) {
        throw new BadRequestException(
          'Informe a forma de pagamento (PIX, dinheiro, transferência, etc.) ao marcar como pago um lançamento que você mesmo criou.',
        );
      }
    }

    try {
      await this.prisma.financeiro.update({
        where: { id: Number(id) },
        data: {
          status,
          pago: isPago,
          // Atualiza forma_pagamento se foi informada na confirmação.
          ...(extras?.formaPagamento ? { forma_pagamento: extras.formaPagamento } : {}),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[updateStatus] Falha ao atualizar lancamento ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel atualizar o status. Tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Auditoria sempre — mas com destaque pra mudança de pago (mais sensível).
    const ctx = await this.carregarContextoLancamento(id);
    await this.auditoria.registrar({
      id_condominio: lanc.id_condominio,
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'STATUS',
      modulo: 'financeiro',
      entidade_id: id,
      descricao: pagoAnterior !== isPago
        ? (isPago === 1
          ? `Marcou como PAGO: ${lanc.nome ?? '(sem nome)'} — ${ctx?.lancamento.valorFormatado ?? ''}`
          : `Desfez pagamento: ${lanc.nome ?? '(sem nome)'} — ${ctx?.lancamento.valorFormatado ?? ''}`)
        : `Alterou status do lançamento: ${lanc.nome ?? '(sem nome)'}`,
      detalhes: {
        contexto: ctx,
        changes: {
          status: { de: statusAnterior, para: status },
          pago: { de: pagoAnterior === 1, para: isPago === 1 },
        },
        // Justificativa de auto-aprovação — fica no rastro pra sempre.
        ...(isAutoAprovacao || extras?.motivo
          ? {
              justificativa: {
                autoAprovacao: !!isAutoAprovacao,
                motivo: extras?.motivo ?? null,
                formaPagamento: extras?.formaPagamento ?? null,
                identificadorComprovante: extras?.identificadorComprovante ?? null,
                autorOriginal: lancCompleto?.nome_operador ?? null,
                aprovadoPor: user?.nome ?? null,
              },
            }
          : {}),
      },
    });

    return { success: true };
  }

  // Auxiliar para computar meses gerais que tenham lançamentos
  private async getAllMeses(idCondominio: number) {
    const list = await this.prisma.financeiro.findMany({
      where: { id_condominio: Number(idCondominio) },
      select: { data: true, data_vencimento: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    const setMesesMap = new Map<string, any>();
    const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const hoje = new Date();
    const currentYear = hoje.getFullYear();
    const currentMonth = hoje.getMonth() + 1;

    for (const item of list) {
      const d = item.data || item.data_vencimento || item.created_at;
      const m = d.getMonth() + 1;
      const y = d.getFullYear();

      // Desconsiderar lançamentos de meses futuros
      if (y > currentYear || (y === currentYear && m > currentMonth)) {
        continue;
      }

      const mStr = m < 10 ? '0' + m : String(m);
      const chave = `${mStr}/${y}`;

      if (!setMesesMap.has(chave)) {
        setMesesMap.set(chave, {
          mes: mStr,
          ano: String(y),
          periodo: `${mesesNomes[m - 1]}/${y}`,
        });
      }
    }

    // Garantir que o mês atual esteja sempre presente
    const mStrHoje = currentMonth < 10 ? '0' + currentMonth : String(currentMonth);
    const chaveHoje = `${mStrHoje}/${currentYear}`;
    if (!setMesesMap.has(chaveHoje)) {
      setMesesMap.set(chaveHoje, {
        mes: mStrHoje,
        ano: String(currentYear),
        periodo: `${mesesNomes[currentMonth - 1]}/${currentYear}`,
      });
    }

    const result = Array.from(setMesesMap.values());
    result.sort((a, b) => {
      const yearA = parseInt(a.ano);
      const yearB = parseInt(b.ano);
      if (yearA !== yearB) {
        return yearA - yearB;
      }
      const monthA = parseInt(a.mes);
      const monthB = parseInt(b.mes);
      return monthA - monthB;
    });

    return result;
  }

  async handleAsaasWebhook(body: any) {
    if (!this.prisma.isConnected) return { success: true };
    this.logger.log(`Webhook recebido: ${body?.event} ref=${body?.payment?.externalReference}`);

    if (body.event !== 'PAYMENT_RECEIVED' && body.event !== 'PAYMENT_CONFIRMED') {
      return { success: true, skipped: true };
    }

    const financeiroId = Number(body?.payment?.externalReference);
    if (!financeiroId) {
      this.logger.warn(`Webhook Asaas sem externalReference válido — ignorado`);
      return { success: true, skipped: true };
    }

    const lanc = await this.prisma.financeiro.findUnique({
      where: { id: financeiroId },
      select: { id: true, valor: true, pago: true, id_condominio: true, nome: true },
    });
    if (!lanc) {
      this.logger.warn(`Webhook Asaas: lançamento ${financeiroId} não encontrado`);
      return { success: true, skipped: true };
    }

    // Idempotência: se já está pago, não reprocessa (evita push duplicado
    // se o Asaas reenviar o webhook).
    if (lanc.pago === 1) {
      this.logger.log(`Webhook Asaas: lançamento ${financeiroId} já pago — ignorado`);
      return { success: true, alreadyPaid: true };
    }

    // Valida valor recebido contra valor cadastrado. Pagamento parcial NÃO
    // deve marcar como pago. Asaas envia `payment.value` (valor original) e
    // `payment.netValue` (líquido após taxa). Comparamos o valor bruto.
    const valorRecebido = Number(body?.payment?.value ?? 0);
    const valorEsperado = Math.abs(Number(lanc.valor ?? 0));
    if (valorRecebido > 0 && valorEsperado > 0 && valorRecebido < valorEsperado - 0.01) {
      this.logger.warn(
        `Webhook Asaas: pagamento parcial detectado para lançamento ${financeiroId} ` +
        `(recebido R$ ${valorRecebido.toFixed(2)}, esperado R$ ${valorEsperado.toFixed(2)}) — NÃO marcado como pago`,
      );
      return { success: true, partialPayment: true };
    }

    try {
      await this.prisma.financeiro.update({
        where: { id: financeiroId },
        data: {
          status: '1',
          pago: 1,
          data: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[asaasWebhook] Falha ao confirmar pagamento ${financeiroId}: ${err?.message ?? err}`,
        err?.stack,
      );
      return { success: false, error: 'db_update_failed' };
    }
    this.logger.log(`Pagamento confirmado via Webhook para Lançamento ID: ${financeiroId} (R$ ${valorRecebido.toFixed(2)})`);

    // Auditoria: webhook é mutação financeira automatizada, precisa de rastro.
    await this.auditoria.registrar({
      id_condominio: lanc.id_condominio,
      usuario_nome: 'Webhook Asaas',
      acao: 'STATUS',
      modulo: 'financeiro',
      entidade_id: lanc.id,
      descricao: `Pagamento confirmado via Asaas: ${lanc.nome}`,
      detalhes: {
        event: body.event,
        valorRecebido,
        valorEsperado,
        asaasPaymentId: body?.payment?.id,
        netValue: body?.payment?.netValue,
      },
    });

    return { success: true };
  }

  async handleOpenPixWebhook(body: any) {
    if (!this.prisma.isConnected) return { success: true };
    this.logger.log(`Webhook OpenPix recebido: ${body?.event} correlationID=${body?.charge?.correlationID}`);

    if (body?.event !== 'OPENPIX:CHARGE_COMPLETED') {
      return { success: true, skipped: true };
    }

    const correlationID = body?.charge?.correlationID;
    if (!correlationID || !correlationID.startsWith('financeiro_')) {
      this.logger.warn(`Webhook OpenPix sem correlationID válido — ignorado`);
      return { success: true, skipped: true };
    }

    const financeiroId = Number(correlationID.replace('financeiro_', ''));
    if (!financeiroId) {
      this.logger.warn(`Webhook OpenPix: ID inválido extraído de ${correlationID}`);
      return { success: true, skipped: true };
    }

    const lanc = await this.prisma.financeiro.findUnique({
      where: { id: financeiroId },
      select: { id: true, valor: true, pago: true, id_condominio: true, nome: true },
    });
    if (!lanc) {
      this.logger.warn(`Webhook OpenPix: lançamento ${financeiroId} não encontrado`);
      return { success: true, skipped: true };
    }

    if (lanc.pago === 1) {
      this.logger.log(`Webhook OpenPix: lançamento ${financeiroId} já pago — ignorado`);
      return { success: true, alreadyPaid: true };
    }

    const valorRecebido = Number(body?.charge?.value ?? 0) / 100;
    const valorEsperado = Math.abs(Number(lanc.valor ?? 0));
    if (valorRecebido > 0 && valorEsperado > 0 && valorRecebido < valorEsperado - 0.01) {
      this.logger.warn(
        `Webhook OpenPix: pagamento parcial detectado para lançamento ${financeiroId} ` +
        `(recebido R$ ${valorRecebido.toFixed(2)}, esperado R$ ${valorEsperado.toFixed(2)}) — NÃO marcado como pago`,
      );
      return { success: true, partialPayment: true };
    }

    try {
      await this.prisma.financeiro.update({
        where: { id: financeiroId },
        data: {
          status: '1',
          pago: 1,
          data: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[openpixWebhook] Falha ao confirmar pagamento ${financeiroId}: ${err?.message ?? err}`,
        err?.stack,
      );
      return { success: false, error: 'db_update_failed' };
    }
    this.logger.log(`Pagamento confirmado via Webhook OpenPix para Lançamento ID: ${financeiroId} (R$ ${valorRecebido.toFixed(2)})`);

    await this.auditoria.registrar({
      id_condominio: lanc.id_condominio,
      usuario_nome: 'Webhook OpenPix',
      acao: 'STATUS',
      modulo: 'financeiro',
      entidade_id: lanc.id,
      descricao: `Pagamento confirmado via OpenPix: ${lanc.nome}`,
      details: {
        event: body.event,
        valorRecebido,
        valorEsperado,
        correlationID,
      },
    } as any);

    return { success: true };
  }

  async createRateio(idCondominio: number, rateioData: { nome: string; valorTotal: number; data_vencimento: string; categoria: string }, operatorName: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
    });

    if (aptos.length === 0) return { success: false, message: 'Nenhum apartamento cadastrado.' };

    const valorPorApto = Number(rateioData.valorTotal) / aptos.length;
    const dVenc = this.parseDataBR(rateioData.data_vencimento);

    // Transação: rateio é all-or-nothing. Se cair na metade, alguns aptos
    // ficavam com cobrança e outros não, sem operador saber.
    const createdCharges = await this.prisma.$transaction(
      aptos.map((apto) =>
        this.prisma.financeiro.create({
          data: {
            nome: `Apto ${apto.apto} Bloco ${apto.bloco} - Rateio: ${rateioData.nome}`,
            tipo: 'C',
            valor: valorPorApto,
            data_vencimento: dVenc,
            categoria: rateioData.categoria ?? 'Geral',
            descricao: `Rateio extraordinário referente a: ${rateioData.nome}`,
            nome_operador: operatorName,
            id_condominio: Number(idCondominio),
            pago: 0,
            status: '0',
          },
        }),
      ),
    );

    // Generate OpenPix charges for rateio items in background
    for (const charge of createdCharges) {
      this.openPix.generateCharge(`financeiro_${charge.id}`, valorPorApto, charge.nome ?? 'Rateio')
        .then(async (pixData) => {
          if (pixData?.brCode) {
            await this.prisma.financeiro.update({
              where: { id: charge.id },
              data: { pix_copia_cola: pixData.brCode },
            });
          }
        })
        .catch((e) => this.logger.error(`Failed to generate OpenPix for rateio charge ${charge.id}: ${e}`));
    }

    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'CREATE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Criou rateio "${rateioData.nome}" — ${formatReal(rateioData.valorTotal)} dividido em ${aptos.length} aptos (${formatReal(valorPorApto)} cada)`,
      detalhes: {
        rateio: {
          nome: rateioData.nome,
          categoria: rateioData.categoria,
          valorTotal: rateioData.valorTotal,
          valorTotalFormatado: formatReal(rateioData.valorTotal),
          valorPorApto,
          valorPorAptoFormatado: formatReal(valorPorApto),
          dataVencimento: rateioData.data_vencimento,
          quantidadeAptos: aptos.length,
          aptos: aptos.slice(0, 20).map((a) => `${a.bloco}-${a.apto}`),
        },
      },
    });

    return { success: true, count: createdCharges.length, message: `Cobrança rateada criada para ${createdCharges.length} apartamentos.` };
  }

  async createAcordoInadimplente(idCondominio: number, acordoData: { apto: string; bloco: string; parcelas: number; valorTotal: number }, operatorName: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    // Busca débitos com filtro amplo (contains) mas FILTRA na aplicação
    // com match exato. Sem isso, "Apto 10 Bloco A" pegava TAMBÉM débitos de
    // "Apto 100/101/1010 Bloco A" e renegociava em lote — apaga dívidas
    // de outros apartamentos.
    const candidatos = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        nome: {
          contains: `Apto ${acordoData.apto} Bloco ${acordoData.bloco}`,
        },
      },
    });

    const debitos = candidatos.filter((d) =>
      this.nomeFaturaDeApto(d.nome, acordoData.apto, acordoData.bloco)
    );

    if (debitos.length === 0) return { success: false, message: 'Nenhum débito em aberto encontrado.' };

    const valorParcela = Number(acordoData.valorTotal) / Number(acordoData.parcelas);
    const hoje = new Date();

    // Transação: renegociar débitos e criar parcelas é all-or-nothing.
    // Sem isso, fica débito como "renegociado" sem as parcelas correspondentes.
    const parcelasOperations = [];
    for (let i = 1; i <= acordoData.parcelas; i++) {
      const vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + i, 10);
      parcelasOperations.push(
        this.prisma.financeiro.create({
          data: {
            nome: `Apto ${acordoData.apto} Bloco ${acordoData.bloco} - Acordo Parc. ${i}/${acordoData.parcelas}`,
            tipo: 'C',
            valor: valorParcela,
            data_vencimento: vencimento,
            categoria: 'Acordo',
            descricao: `Acordo de débitos anteriores parcelado pelo síndico. Parcela ${i} de ${acordoData.parcelas}`,
            nome_operador: operatorName,
            id_condominio: Number(idCondominio),
            pago: 0,
            status: '0',
          },
        }),
      );
    }

    await this.prisma.$transaction([
      ...debitos.map((deb) =>
        this.prisma.financeiro.update({
          where: { id: deb.id },
          data: {
            status: '3',
            descricao: `Renegociado no acordo em lote pelo síndico.`,
          },
        }),
      ),
      ...parcelasOperations,
    ]);

    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'CREATE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Acordo de inadimplência: Apto ${acordoData.apto} Bloco ${acordoData.bloco} — ${formatReal(acordoData.valorTotal)} em ${acordoData.parcelas}x de ${formatReal(valorParcela)}`,
      detalhes: {
        acordo: {
          apto: acordoData.apto,
          bloco: acordoData.bloco,
          valorTotal: acordoData.valorTotal,
          valorTotalFormatado: formatReal(acordoData.valorTotal),
          parcelas: acordoData.parcelas,
          valorParcela,
          valorParcelaFormatado: formatReal(valorParcela),
          debitosOriginaisRenegociados: debitos.length,
          debitosOriginais: debitos.map((d) => ({ id: d.id, nome: d.nome, valor: Number(d.valor) })),
        },
      },
    });

    return { success: true, message: `Acordo firmado com sucesso em ${acordoData.parcelas} parcelas de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` };
  }

  async runBillingRemindersJob() {
    if (!this.prisma.isConnected) return;
    this.logger.log('Iniciando Job de Lembretes de Cobrança...');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeStr = hoje.toISOString().slice(0, 10);

    // Janela de busca otimizada: só faturas com vencimento entre -2 e +6 dias.
    // Antes buscava TODAS as faturas em aberto do sistema (todos os condomínios)
    // — em produção com muitos lançamentos isso virava minutos de processamento.
    const dataMin = new Date(hoje);
    dataMin.setDate(dataMin.getDate() - 2);
    const dataMax = new Date(hoje);
    dataMax.setDate(dataMax.getDate() + 6);

    const faturas = await this.prisma.financeiro.findMany({
      where: {
        pago: 0,
        data_vencimento: { gte: dataMin, lte: dataMax, not: null },
      },
      select: {
        id: true,
        nome: true,
        valor: true,
        data_vencimento: true,
        id_condominio: true,
        pix_copia_cola: true,
      },
    });

    let stats = { faturasProcessadas: 0, pushEnviados: 0, emailsEnviados: 0, deduplicados: 0 };

    for (const fat of faturas) {
      if (!fat.data_vencimento) continue;

      const venc = new Date(fat.data_vencimento);
      venc.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

      let tipo: 'antecipado' | 'hoje' | 'vencido' | null = null;
      let title = '';
      const valorFmt = Number(fat.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      if (diffDays === 5) {
        tipo = 'antecipado';
        title = 'Lembrete de Vencimento';
      } else if (diffDays === 0) {
        tipo = 'hoje';
        title = 'Fatura vence hoje!';
      } else if (diffDays === -1) {
        tipo = 'vencido';
        title = 'Fatura vencida';
      } else {
        continue;
      }

      // Dedup: garante 1 lembrete por fatura por tipo por dia. Sem isso,
      // reboot do backend = todo mundo recebe push de novo.
      const dedupKey = `${fat.id}:${tipo}:${hojeStr}`;
      if (this.lembretesEnviados.has(dedupKey)) {
        stats.deduplicados++;
        continue;
      }

      const aptoMatch = fat.nome?.match(/Apto\s+(\S+)\s+Bloco\s+(\S+)/i);
      if (!aptoMatch) continue;
      const [, apto, bloco] = aptoMatch;

      // TODO: filtrar por preferência `notif_financeiro` quando a coluna for
      // adicionada ao schema Users. Hoje só existem notif_encomendas e
      // notif_visitantes. Não usamos notif_encomendas como proxy porque a
      // semântica é diferente (morador pode querer push de encomenda mas não
      // de cobrança, ou vice-versa).
      const moradores = await this.prisma.users.findMany({
        where: {
          moradores: {
            some: { id_condominio: fat.id_condominio, apartamento: apto, bloco: bloco },
          },
        },
        select: { fcm_token: true, email: true, name: true },
      });

      const body = tipo === 'antecipado'
        ? `Olá! A fatura "${fat.nome}" (${valorFmt}) vence em 5 dias (${venc.toLocaleDateString('pt-BR')}).`
        : tipo === 'hoje'
        ? `A fatura "${fat.nome}" (${valorFmt}) vence hoje. Evite multas e juros.`
        : `A fatura "${fat.nome}" (${valorFmt}) venceu ontem. Regularize seu débito.`;

      for (const morador of moradores) {
        if (morador.fcm_token) {
          try {
            await this.notifications.sendPushNotification(
              morador.fcm_token, title, body,
              { id: fat.id.toString(), type: 'financeiro' },
            );
            stats.pushEnviados++;
          } catch (err) {
            this.logger.warn(`Push falhou para ${morador.name}: ${err}`);
          }
        }
        if (morador.email) {
          try {
            await this.mail.sendBillingReminder(
              morador.email,
              morador.name || 'Morador',
              fat.nome || 'Taxa Condominial',
              venc.toLocaleDateString('pt-BR'),
              valorFmt,
              fat.pix_copia_cola || undefined,
            );
            stats.emailsEnviados++;
          } catch (err) {
            this.logger.error(`Email falhou para ${morador.email}: ${err}`);
          }
        }
      }

      // Marca como enviado APÓS o envio (se quebrou no meio, pode reenviar
      // — aceitável: mensagem duplicada vs. mensagem perdida em fatura crítica).
      this.lembretesEnviados.add(dedupKey);
      stats.faturasProcessadas++;
    }

    this.logger.log(
      `Job de Lembretes concluído: ${stats.faturasProcessadas} faturas processadas, ` +
      `${stats.pushEnviados} push, ${stats.emailsEnviados} emails, ` +
      `${stats.deduplicados} já enviados hoje (skip).`,
    );
  }

  // ==========================================
  // MÉTODOS DE CONTAS INDIVIDUAIS DO MORADOR
  // ==========================================
  async insertMoradorConta(idUser: number, idCondominio: number, data: any) {
    if (!this.prisma.isConnected) return { success: true };

    let valor = parseFloat(String(data.valor || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
    if (isNaN(valor)) valor = 0;

    const dVenc = this.parseDataBR(data.data_vencimento);

    // Mesmo padrao do insert principal: protege contra erros de runtime
    // (Decimal/Prisma) que vazariam mensagens JS internas pro cliente.
    try {
      await this.prisma.financeiro.create({
        data: {
          nome: data.nome || `${data.categoria} Individual`,
          tipo: 'D',
          valor: valor,
          data_vencimento: dVenc,
          categoria: data.categoria || 'Outros',
          pago: data.pago ? Number(data.pago) : 0,
          status: data.pago ? '1' : '0',
          id_condominio: Number(idCondominio),
          id_usuario: Number(idUser),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[insertMoradorConta] Falha: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel salvar a conta. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    return { success: true };
  }

  async updateMoradorConta(idUser: number, idCondominio: number, data: any) {
    if (!this.prisma.isConnected) return { success: true };

    const record = await this.prisma.financeiro.findFirst({
      where: {
        id: Number(data.id),
        id_usuario: Number(idUser),
      },
    });

    if (!record) throw new NotFoundException('Conta não encontrada ou sem permissão.');

    let valor = parseFloat(String(data.valor || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
    if (isNaN(valor)) valor = 0;

    const dVenc = this.parseDataBR(data.data_vencimento);
    const isPago = data.pago ? Number(data.pago) : 0;

    try {
      await this.prisma.financeiro.update({
        where: { id: Number(data.id) },
        data: {
          nome: data.nome,
          valor: valor,
          data_vencimento: dVenc,
          categoria: data.categoria,
          pago: isPago,
          status: isPago === 1 ? '1' : '0',
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[updateMoradorConta] Falha: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel salvar as alteracoes. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    return { success: true };
  }

  async removeMoradorConta(idUser: number, id: number) {
    if (!this.prisma.isConnected) return { success: true };

    const record = await this.prisma.financeiro.findFirst({
      where: {
        id: Number(id),
        id_usuario: Number(idUser),
      },
    });

    if (!record) throw new NotFoundException('Conta não encontrada ou sem permissão.');

    await this.prisma.financeiro.delete({
      where: { id: Number(id) },
    });

    return { success: true };
  }

  async parseOfxContent(idCondominio: number, ofxContent: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    const transactions: any[] = [];
    const stmttrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    let match;
    while ((match = stmttrnRegex.exec(ofxContent)) !== null) {
      const block = match[1];
      const trntype = (/<TRNTYPE>([^\r\n<]+)/i.exec(block)?.[1] ?? '').trim();
      const dtpostedStr = (/<DTPOSTED>([^\r\n<]+)/i.exec(block)?.[1] ?? '').trim();
      const trnamt = parseFloat((/<TRNAMT>([^\r\n<]+)/i.exec(block)?.[1] ?? '0').trim());
      const fitid = (/<FITID>([^\r\n<]+)/i.exec(block)?.[1] ?? '').trim();
      const memo = (/<MEMO>([^\r\n<]+)/i.exec(block)?.[1] ?? '').trim();

      let date = new Date();
      if (dtpostedStr.length >= 8) {
        const year = parseInt(dtpostedStr.substring(0, 4), 10);
        const month = parseInt(dtpostedStr.substring(4, 6), 10) - 1;
        const day = parseInt(dtpostedStr.substring(6, 8), 10);
        date = new Date(year, month, day);
      }

      transactions.push({
        type: trntype,
        date,
        amount: trnamt,
        fitid,
        memo,
      });
    }

    const unpaid = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
      },
    });

    const results = transactions.map(tx => {
      const txType = tx.amount < 0 ? 'D' : 'C';
      const absAmount = Math.abs(tx.amount);

      let bestMatch: any = null;
      let matchType: 'exact' | 'partial' | 'none' = 'none';

      const exactMatches = unpaid.filter(db => {
        const dbType = db.tipo || 'C';
        const dbAmt = Math.abs(Number(db.valor || 0));
        if (dbType !== txType || Math.abs(dbAmt - absAmount) > 0.01) return false;

        const dbDate = db.data_vencimento || db.data || new Date();
        const diffDays = Math.abs(dbDate.getTime() - tx.date.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays <= 5;
      });

      if (exactMatches.length > 0) {
        bestMatch = exactMatches[0];
        matchType = 'exact';
      } else {
        const partialMatches = unpaid.filter(db => {
          const dbType = db.tipo || 'C';
          const dbAmt = Math.abs(Number(db.valor || 0));
          return dbType === txType && Math.abs(dbAmt - absAmount) <= 0.01;
        });

        if (partialMatches.length > 0) {
          bestMatch = partialMatches[0];
          matchType = 'partial';
        }
      }

      return {
        ofxTx: {
          ...tx,
          amount: tx.amount,
          date: tx.date.toISOString(),
        },
        suggestion: bestMatch ? {
          id: bestMatch.id,
          nome: bestMatch.nome,
          tipo: bestMatch.tipo,
          valor: Number(bestMatch.valor),
          data_vencimento: bestMatch.data_vencimento ? bestMatch.data_vencimento.toISOString() : null,
          categoria: bestMatch.categoria,
        } : null,
        matchType,
      };
    });

    return {
      results,
      unpaid: unpaid.map(u => ({
        id: u.id,
        nome: u.nome,
        tipo: u.tipo,
        valor: Number(u.valor),
        data_vencimento: u.data_vencimento ? u.data_vencimento.toISOString() : null,
        categoria: u.categoria,
      }))
    };
  }

  async confirmarConciliacao(idCondominio: number, reconciliations: { databaseId: number; dataPagamento: string }[], user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    // Cada databaseId precisa pertencer ao condomínio — sem isso, atacante
    // marca como pago lançamentos de outros condomínios em massa.
    for (const rec of reconciliations) {
      await this.getLancamentoForTenant(rec.databaseId, user);
    }
    const confirmados: number[] = [];
    const falhas: number[] = [];
    for (const rec of reconciliations) {
      const parsedDate = new Date(rec.dataPagamento);
      const isDateValid = !isNaN(parsedDate.getTime());

      try {
        await this.prisma.financeiro.update({
          where: {
            id: Number(rec.databaseId),
            id_condominio: Number(idCondominio),
          },
          data: {
            pago: 1,
            data: isDateValid ? parsedDate : new Date(),
          },
        });
        confirmados.push(Number(rec.databaseId));
      } catch (err: any) {
        // Não falha a conciliação inteira se um item quebrar — registra
        // o ID que falhou e segue. Operador vê quais não foram confirmados.
        this.logger.warn(
          `[confirmarConciliacao] Falha em ${rec.databaseId}: ${err?.message ?? err}`,
        );
        falhas.push(Number(rec.databaseId));
      }
    }

    if (confirmados.length > 0) {
      await this.auditoria.registrar({
        id_condominio: Number(idCondominio),
        usuario_nome: user?.nome ?? 'Sistema',
        acao: 'STATUS',
        modulo: 'financeiro',
        entidade_id: undefined,
        descricao: `Conciliação bancária: ${confirmados.length} lançamento(s) confirmado(s) como pagos`,
        detalhes: {
          conciliacao: {
            quantidade: confirmados.length,
            ids: confirmados,
            reconciliations,
          },
        },
      });
    }

    return {
      success: true,
      confirmados: confirmados.length,
      falhas: falhas.length,
      ...(falhas.length > 0 ? { idsComFalha: falhas } : {}),
    };
  }

  /**
   * Export do livro caixa em CSV. Filtra pelo mês/ano (período passado pela
   * URL) e gera um CSV UTF-8 com BOM (Excel abre direito com acento).
   *
   * Sem isso, o operador não conseguia gerar prestação de contas — única
   * forma era olhar tela por tela e digitar. Síndico precisa apresentar
   * relatório em assembleia.
   */
  async exportLivroCaixaCsv(
    idCondominio: number,
    mesStr?: string,
    anoStr?: string,
    user?: JwtPayload,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) {
      return { buffer: Buffer.from('Data\n'), filename: 'livro_caixa_vazio.csv' };
    }

    // Resolve mês/ano: se não vier, usa o mês com lançamentos mais recente
    // (mesma lógica do getAll, pra manter consistência com o que o operador
    // está vendo na tela).
    const mesesDisponiveis = await this.getAllMeses(idCondominio);
    let mes = mesStr ? Number(mesStr) : null;
    let ano = anoStr ? Number(anoStr) : null;
    if ((!mes || !ano) && mesesDisponiveis.length > 0) {
      const ult = mesesDisponiveis[mesesDisponiveis.length - 1];
      mes = Number(ult.mes);
      ano = Number(ult.ano);
    }
    mes = mes ?? new Date().getMonth() + 1;
    ano = ano ?? new Date().getFullYear();

    const dataIni = new Date(ano, mes - 1, 1);
    const dataFim = new Date(ano, mes, 0);

    const list = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        OR: [
          { data: { gte: dataIni, lte: dataFim } },
          { data_vencimento: { gte: dataIni, lte: dataFim } },
        ],
      },
      orderBy: [{ data: 'asc' }, { data_vencimento: 'asc' }],
    });

    // Calcula saldo corrente igual o getAll faz na tela — operador espera
    // ver o mesmo número que aparece no painel.
    let saldoCorrente = 0;
    const linhasDados: string[][] = [];

    for (const item of list) {
      let v = item.valor ? Number(item.valor) : 0;
      if (item.tipo === 'D') v = -Math.abs(v);
      else v = Math.abs(v);

      if (item.pago === 1) saldoCorrente += v;

      const fmtDate = (d: Date | null) =>
        d ? d.toLocaleDateString('pt-BR') : '';
      const fmtBRL = (n: number) =>
        n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      linhasDados.push([
        fmtDate(item.data),
        fmtDate(item.data_vencimento),
        item.tipo === 'D' ? 'Despesa' : 'Receita',
        item.nome ?? '',
        item.categoria ?? '',
        item.conta ?? '',
        item.cliente ?? '',
        item.forma_pagamento ?? '',
        item.descricao ?? '',
        fmtBRL(v),
        fmtBRL(saldoCorrente),
        item.pago === 1 ? 'Pago' : 'Em aberto',
        item.nome_operador ?? '',
      ]);
    }

    const header = [
      'Data Pagamento',
      'Vencimento',
      'Tipo',
      'Descrição',
      'Categoria',
      'Conta',
      'Cliente',
      'Forma de Pagamento',
      'Observação',
      'Valor',
      'Saldo Acumulado',
      'Status',
      'Operador',
    ];
    const lines = [header.map(this.csvEscape).join(',')];
    for (const row of linhasDados) {
      lines.push(row.map(this.csvEscape).join(','));
    }

    // BOM para o Excel reconhecer UTF-8 e renderizar acentos.
    const csv = '﻿' + lines.join('\n');
    const mesPad = String(mes).padStart(2, '0');
    return {
      buffer: Buffer.from(csv, 'utf8'),
      filename: `livro_caixa_${idCondominio}_${mesPad}-${ano}.csv`,
    };
  }

  private csvEscape(value: string): string {
    if (value == null) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  async getConfigAuto(idCondominio: number, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const cond = await this.prisma.condominios.findUnique({
      where: { id: Number(idCondominio) },
      select: {
        recorrencia_ativa: true,
        valor_condominio: true,
        dia_geracao: true,
        dia_vencimento: true,
        categoria_padrao: true,
        cobranca_auto_whats: true,
        dias_atraso_aviso_1: true,
        dias_atraso_aviso_2: true,
        dias_atraso_aviso_3: true,
      },
    });

    return cond;
  }

  async updateConfigAuto(idCondominio: number, config: any, operatorName: string, user?: JwtPayload) {
    if (user?.id_condominio) {
      assertSameTenant(idCondominio, user, `condomínio ${idCondominio}`);
    }
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const updated = await this.prisma.condominios.update({
      where: { id: Number(idCondominio) },
      data: {
        recorrencia_ativa: config.recorrencia_ativa ?? false,
        valor_condominio: config.valor_condominio !== undefined ? Number(config.valor_condominio) : undefined,
        dia_geracao: config.dia_geracao !== undefined ? Number(config.dia_geracao) : undefined,
        dia_vencimento: config.dia_vencimento !== undefined ? Number(config.dia_vencimento) : undefined,
        categoria_padrao: config.categoria_padrao !== undefined ? String(config.categoria_padrao) : undefined,
        cobranca_auto_whats: config.cobranca_auto_whats ?? false,
        dias_atraso_aviso_1: config.dias_atraso_aviso_1 !== undefined ? Number(config.dias_atraso_aviso_1) : undefined,
        dias_atraso_aviso_2: config.dias_atraso_aviso_2 !== undefined ? Number(config.dias_atraso_aviso_2) : undefined,
        dias_atraso_aviso_3: config.dias_atraso_aviso_3 !== undefined ? Number(config.dias_atraso_aviso_3) : undefined,
      },
    });

    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'UPDATE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Atualizou configurações de cobrança automática e recorrência`,
      detalhes: config,
    });

    return { success: true, config: updated };
  }

  async runRecurringBillingJob() {
    if (!this.prisma.isConnected) return;
    this.logger.log('Iniciando Job de Faturamento Recorrente...');

    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const refStr = `${String(mesAtual).padStart(2, '0')}/${anoAtual}`;

    // Busca todos os condomínios com recorrência ativa
    const condominios = await this.prisma.condominios.findMany({
      where: { recorrencia_ativa: true },
      select: {
        id: true,
        nome: true,
        valor_condominio: true,
        dia_geracao: true,
        dia_vencimento: true,
        categoria_padrao: true,
      },
    });

    for (const cond of condominios) {
      if (cond.dia_geracao !== diaAtual) {
        continue;
      }

      // Calcula data de vencimento da fatura
      let vencMonth = mesAtual;
      let vencYear = anoAtual;
      if (cond.dia_vencimento < cond.dia_geracao) {
        vencMonth += 1;
        if (vencMonth > 12) {
          vencMonth = 1;
          vencYear += 1;
        }
      }
      const dataVencimento = new Date(vencYear, vencMonth - 1, cond.dia_vencimento, 12, 0, 0, 0);

      // Busca todos os apartamentos do condomínio
      const aptos = await this.prisma.apartamentos.findMany({
        where: { id_condominio: cond.id },
      });

      this.logger.log(`Gerando faturas recorrentes para o condomínio ${cond.nome} (${aptos.length} apartamentos)...`);

      for (const apto of aptos) {
        const faturaNome = `Apto ${apto.apto} Bloco ${apto.bloco} - ${cond.categoria_padrao} Ref. ${refStr}`;

        // Evita gerar faturas duplicadas
        const existe = await this.prisma.financeiro.findFirst({
          where: {
            id_condominio: cond.id,
            nome: faturaNome,
          },
        });

        if (existe) {
          continue;
        }

        // Cria a fatura
        let criado = await this.prisma.financeiro.create({
          data: {
            id_condominio: cond.id,
            nome: faturaNome,
            tipo: 'C',
            valor: Number(cond.valor_condominio ?? 0),
            data: hoje,
            data_vencimento: dataVencimento,
            pago: 0,
            status: '0',
            categoria: cond.categoria_padrao,
            descricao: `Faturamento automático recorrente de taxa condominial referente a ${refStr}.`,
            nome_operador: 'Sistema Click',
          },
        });

        // Tenta gerar o Pix dinâmico via OpenPix
        try {
          const pixData = await this.openPix.generateCharge(
            `financeiro_${criado.id}`,
            Math.abs(Number(criado.valor)),
            criado.nome ?? 'Cobrança',
          );
          if (pixData?.brCode) {
            criado = await this.prisma.financeiro.update({
              where: { id: criado.id },
              data: { pix_copia_cola: pixData.brCode },
            });
          }
        } catch (pixErr) {
          this.logger.error(`[runRecurringBillingJob] Erro OpenPix para fatura ${criado.id}: ${pixErr}`);
        }

        // Notifica moradores do apartamento
        const moradores = await this.prisma.users.findMany({
          where: {
            moradores: {
              some: { id_condominio: cond.id, apartamento: apto.apto, bloco: apto.bloco },
            },
          },
          select: { fcm_token: true, email: true, name: true, phone: true },
        });

        const valorFmt = Number(criado.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const textMessage = `Olá! A taxa condominial de seu apartamento (Apto ${apto.apto} Bloco ${apto.bloco}) referente a ${refStr} no valor de ${valorFmt} foi emitida e vence em ${dataVencimento.toLocaleDateString('pt-BR')}.`;

        for (const morador of moradores) {
          // 1. Push
          if (morador.fcm_token) {
            try {
              await this.notifications.sendPushNotification(
                morador.fcm_token,
                'Nova Fatura Emitida',
                textMessage,
                { id: criado.id.toString(), type: 'financeiro' },
              );
            } catch (_) {}
          }
          // 2. WhatsApp (Z-API)
          const cleanPhone = morador.phone?.replace(/\D/g, '');
          if (cleanPhone && cleanPhone.length >= 10) {
            try {
              let whatsMsg = textMessage;
              if (criado.pix_copia_cola) {
                whatsMsg += `\n\nVocê pode pagar copiando o código Pix abaixo:\n\n${criado.pix_copia_cola}`;
              }
              await this.notifications.sendWhatsApp(cleanPhone, whatsMsg);
            } catch (whatsErr) {
              this.logger.error(`[runRecurringBillingJob] Erro WhatsApp para ${morador.name}: ${whatsErr}`);
            }
          }
        }
      }
    }
  }

  async runAutoWhatsAppDunningJob() {
    if (!this.prisma.isConnected) return;
    this.logger.log('Iniciando Job de Régua de Cobrança Automática via WhatsApp...');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeStr = hoje.toISOString().slice(0, 10);

    // Busca todos os condomínios com cobrança automatizada via WhatsApp ativa
    const condominios = await this.prisma.condominios.findMany({
      where: { cobranca_auto_whats: true },
      select: {
        id: true,
        nome: true,
        dias_atraso_aviso_1: true,
        dias_atraso_aviso_2: true,
        dias_atraso_aviso_3: true,
      },
    });

    for (const cond of condominios) {
      // Busca faturas vencidas em aberto deste condomínio
      const faturas = await this.prisma.financeiro.findMany({
        where: {
          id_condominio: cond.id,
          pago: 0,
          tipo: 'C',
          data_vencimento: { lt: hoje, not: null },
        },
        select: {
          id: true,
          nome: true,
          valor: true,
          data_vencimento: true,
          pix_copia_cola: true,
        },
      });

      for (const fat of faturas) {
        if (!fat.data_vencimento) continue;

        const venc = new Date(fat.data_vencimento);
        venc.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((hoje.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));

        let avisoTipo: 'aviso_1' | 'aviso_2' | 'aviso_3' | null = null;

        if (diffDays === cond.dias_atraso_aviso_1) {
          avisoTipo = 'aviso_1';
        } else if (diffDays === cond.dias_atraso_aviso_2) {
          avisoTipo = 'aviso_2';
        } else if (diffDays === cond.dias_atraso_aviso_3) {
          avisoTipo = 'aviso_3';
        }

        if (!avisoTipo) continue;

        // Dedup: evita reenvio no mesmo dia
        const dedupKey = `${fat.id}:${avisoTipo}:${hojeStr}`;
        if (this.lembretesEnviados.has(dedupKey)) {
          continue;
        }

        const aptoMatch = fat.nome?.match(/Apto\s+(\S+)\s+Bloco\s+(\S+)/i);
        if (!aptoMatch) continue;
        const [, apto, bloco] = aptoMatch;

        const moradores = await this.prisma.users.findMany({
          where: {
            moradores: {
              some: { id_condominio: cond.id, apartamento: apto, bloco: bloco },
            },
          },
          select: { name: true, phone: true },
        });

        const valorFmt = Number(fat.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const textMessage = avisoTipo === 'aviso_1'
          ? `Lembrete de Cobrança: Identificamos que a fatura "${fat.nome}" no valor de ${valorFmt} venceu em ${venc.toLocaleDateString('pt-BR')} (atraso de ${diffDays} dia).`
          : avisoTipo === 'aviso_2'
          ? `Aviso de Atraso: A fatura "${fat.nome}" (${valorFmt}) está vencida há ${diffDays} dias. Por favor, regularize o quanto antes.`
          : `Notificação Importante: A fatura "${fat.nome}" (${valorFmt}) está vencida há ${diffDays} dias no sistema. Evite suspensão de serviços ou protesto.`;

        for (const morador of moradores) {
          const cleanPhone = morador.phone?.replace(/\D/g, '');
          if (cleanPhone && cleanPhone.length >= 10) {
            try {
              let whatsMsg = `Olá, ${morador.name}!\n\n${textMessage}`;
              if (fat.pix_copia_cola) {
                whatsMsg += `\n\nPara facilitar, efetue o pagamento copiando o código Pix abaixo:\n\n${fat.pix_copia_cola}`;
              }
              await this.notifications.sendWhatsApp(cleanPhone, whatsMsg);
            } catch (whatsErr) {
              this.logger.error(`[runAutoWhatsAppDunningJob] Erro WhatsApp para ${morador.name}: ${whatsErr}`);
            }
          }
        }

        this.lembretesEnviados.add(dedupKey);
      }
    }
  }
}
