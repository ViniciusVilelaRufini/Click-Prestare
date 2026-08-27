import { Injectable, NotFoundException, OnModuleInit, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MailService } from '../common/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { TenantAccessService } from '../auth/tenant-access.service';
import { isOperador } from '../auth/tenant.util';
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
    private readonly tenant: TenantAccessService,
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
  /**
   * Diz se uma cobrança de condomínio (sem id_usuario) é da unidade do morador,
   * comparando o nome da fatura ("Apto X Bloco Y - Ref...") com os apartamentos
   * dele. Mesma regra usada na leitura em `get`.
   */
  private async lancamentoEhDaUnidadeDoMorador(
    nomeLancamento: string | null | undefined,
    idUser: number,
    idCondominio: number,
  ): Promise<boolean> {
    if (!nomeLancamento || !idUser) return false;

    const [moradoresList, auList] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_user: Number(idUser), id_condominio: Number(idCondominio) },
        select: { apartamento: true, bloco: true },
      }),
      this.prisma.apartamentos_Users.findMany({
        where: {
          id_user: Number(idUser),
          apartamento: { id_condominio: Number(idCondominio) },
        },
        include: { apartamento: true },
      }),
    ]);

    const userUnits = [
      ...moradoresList.map((m) => ({ bloco: m.bloco, apartamento: m.apartamento })),
      ...auList.map((au) => ({
        bloco: au.apartamento?.bloco,
        apartamento: au.apartamento?.apto,
      })),
    ].filter((u) => u.apartamento != null && u.apartamento !== '');

    return userUnits.some((u) =>
      this.nomeFaturaDeApto(nomeLancamento, u.apartamento, u.bloco),
    );
  }

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

  /**
   * `status = '3'` marca a cobrança RENEGOCIADA num acordo: ela foi
   * substituída pelas parcelas do acordo e não é mais dívida viva.
   *
   * O acordo já gravava esse status, mas nenhuma consulta o lia — a dívida
   * original continuava contando na inadimplência ao lado das parcelas novas,
   * e o apartamento aparecia devendo duas vezes o mesmo valor (nos cards, no
   * percentual de inadimplência e na tela do morador). Este filtro é o par que
   * faltava; use em toda leitura de dívida em aberto.
   */
  private static readonly NAO_RENEGOCIADO = { status: { not: '3' } } as const;

  /**
   * Unidade "fantasma" = registro de Apartamentos que não representa uma
   * unidade real (ex.: "Apto 000 Bloco Condominio" criado por engano).
   * Essas unidades não podem receber cobrança nem contar na inadimplência.
   */
  private isUnidadeFantasma(apto?: string | null, bloco?: string | null): boolean {
    const aptoNorm = (apto ?? '').trim();
    const blocoNorm = (bloco ?? '').trim().toLowerCase();
    if (!aptoNorm || /^0+$/.test(aptoNorm)) return true;
    return blocoNorm === 'condominio' || blocoNorm === 'condomínio';
  }

  /**
   * Parser unificado de valor monetário BR/US.
   *
   * Só trata `.` como separador de milhar quando também há `,` na string
   * (ex.: "1.234,56") — senão um valor já em formato decimal com ponto
   * (ex.: "150.50", comum em teclados/locale EN) teria o ponto removido e
   * viraria "15050" (inflação de 100x). Era exatamente o bug que existia
   * em insertMoradorConta/updateMoradorConta antes desta unificação.
   */
  private parseValorMonetario(raw: unknown): number {
    if (typeof raw === 'number') return raw;
    let str = String(raw || '0').replace('R$', '').trim();
    if (str.includes(',')) {
      str = str.replace(/\./g, '').replace(',', '.');
    }
    const valor = parseFloat(str);
    return isNaN(valor) ? 0 : valor;
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
      select: { id: true, id_condominio: true, nome: true, valor: true, tipo: true, pago: true, status: true, id_usuario: true, data: true, data_vencimento: true, origem: true },
    });
    if (!lanc) throw new NotFoundException(`Lançamento ${id} não encontrado`);
    await this.tenant.assertEntidade(lanc.id_condominio, user, `lançamento #${id}`);
    return lanc;
  }

  /**
   * Barra alteração em lançamento espelhado de sistema externo.
   *
   * Cobrança vinda da Superlógica é somente leitura no Clique: a fonte da
   * verdade é o ERP. Editar aqui faria o app mostrar um valor — ou um "pago" —
   * que o ERP não conhece, e a próxima sincronização sobrescreveria em silêncio.
   * Anexar comprovante continua permitido: o sync não toca nesse campo.
   */
  private assertLancamentoEditavel(lanc: { origem?: string | null }, acao: string) {
    if (lanc.origem === 'superlogica') {
      throw new BadRequestException(
        `Este lançamento vem da Superlógica e não pode ser ${acao} no Clique. Faça a alteração no ERP — a sincronização traz a mudança em até uma hora.`,
      );
    }
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
        temComprovante: !!(l.url_comprovante ?? l.photo),
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
    await this.tenant.assertCondominio(idCondominio, user);

    // Bloqueia inserção em mês fechado. Checagem feita já com a data
    // parseada para reaproveitar o helper, abaixo após o parsing.

    let valor = this.parseValorMonetario(financeiro.valor);

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
    let statusStr = financeiro.status == null
      ? '0'
      : String(financeiro.status);
    if (isPago === 1) {
      statusStr = '1';
    }

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
          criado.data_vencimento,
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

    // id do lançamento criado: permite ao cliente anexar boleto/comprovante
    // logo após criar (upload-shared-file exige o id). Retrocompatível.
    return { success: true, id: criado.id };
  }

  async update(idCondominio: number, financeiro: any, operatorName: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida: id_condominio do body bate com JWT, e lançamento existe nesse condomínio.
    await this.tenant.assertCondominio(idCondominio, user);
    if (financeiro?.id) {
      const alvo = await this.getLancamentoForTenant(Number(financeiro.id), user);
      this.assertLancamentoEditavel(alvo, 'editado');
    }

    let valor = this.parseValorMonetario(financeiro.valor);

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

    let finalStatus = antes?.status ?? '0';
    if (isPago === 1) {
      finalStatus = '1';
    } else if (financeiro.status !== undefined && financeiro.status !== null) {
      finalStatus = String(financeiro.status);
    } else if (antes?.pago === 1 && isPago === 0) {
      finalStatus = '0';
    }

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
          status: finalStatus,
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

    // Pix dinâmico é gerado com o valor da época. Se o síndico corrige o valor
    // de uma cobrança em aberto, o código antigo continua cobrando o valor
    // velho — o morador paga, o webhook vê "pagamento parcial" e a fatura fica
    // em aberto mesmo tendo sido paga. Regenera a cobrança com o valor novo.
    const valorMudou =
      antes?.valor != null && Math.abs(Math.abs(Number(antes.valor)) - Math.abs(valor)) > 0.001;
    const pixVeioDoCliente = financeiro.pix_copia_cola !== undefined;
    if (valorMudou && isPago === 0 && !pixVeioDoCliente && antes?.pix_copia_cola) {
      try {
        const pixData = await this.openPix.generateCharge(
          `financeiro_${financeiro.id}_v${Date.now()}`,
          Math.abs(valor),
          financeiro.nome ?? antes.nome ?? 'Cobrança',
          dVenc ?? antes.data_vencimento,
        );
        await this.prisma.financeiro.update({
          where: { id: Number(financeiro.id) },
          // Sem Pix novo, melhor ficar sem código do que manter um que cobra
          // valor errado — o morador ainda paga pela chave Pix do condomínio.
          data: { pix_copia_cola: pixData?.brCode ?? null },
        });
      } catch (err: any) {
        this.logger.error(`[financeiro.update] Falha ao regerar Pix de ${financeiro.id}: ${err?.message ?? err}`);
        await this.prisma.financeiro.update({
          where: { id: Number(financeiro.id) },
          data: { pix_copia_cola: null },
        });
      }
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
    this.assertLancamentoEditavel(lanc, 'removido');

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

  async get(idCondominio: number, id: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return {
        id, nome: 'Taxa Condominial', tipo: 'C', valor: 650.0,
        data_vencimento: '10/05/2026', data: '10/05/2026',
        categoria: 'Taxa Condominial', pago: 1, id_usuario: null,
      };
    }

    // Validação de tenant mobile-aware: porteiro/síndico web tem id_condominio
    // fixo no JWT (compara direto); síndico/morador do app não têm — o
    // TenantAccessService resolve o vínculo real consultando o banco.
    await this.tenant.assertCondominio(idCondominio, user);

    const result = await this.prisma.financeiro.findFirst({
      where: { id: Number(id), id_condominio: Number(idCondominio) },
    });

    if (!result) throw new NotFoundException('Lançamento não encontrado.');

    // Morador só pode ver lançamentos vinculados a ele OU cobranças do seu apto.
    // Sem isso, morador chuta IDs e lê dados financeiros de qualquer um.
    const typeAccess = user?.typeAccess ?? user?.user?.typeAccess;
    const isMorador = typeAccess === 'Morador';
    if (isMorador) {
      const userId = user?.sub ?? user?.user?.id;
      const podeVer = result.id_usuario === userId;
      if (!podeVer && result.nome) {
        // Para faturas de apto (nome "Apto X Bloco Y - Ref. ..."), verifica se o
        // morador realmente mora nesse apto. Match por id_user em Moradores e Apartamentos_Users.
        const moradoresList = await this.prisma.moradores.findMany({
          where: {
            id_user: Number(userId),
            id_condominio: Number(idCondominio),
          },
          select: { apartamento: true, bloco: true },
        });
        const auList = await this.prisma.apartamentos_Users.findMany({
          where: {
            id_user: Number(userId),
            apartamento: { id_condominio: Number(idCondominio) },
          },
          include: { apartamento: true },
        });
        const userUnits = [
          ...moradoresList.map(m => ({ bloco: m.bloco, apartamento: m.apartamento })),
          ...auList.map(au => ({ bloco: au.apartamento?.bloco, apartamento: au.apartamento?.apto })),
        ].filter(unit => unit.apartamento != null && unit.apartamento !== '');

        const match = userUnits.some(unit =>
          this.nomeFaturaDeApto(result.nome, unit.apartamento, unit.bloco)
        );
        if (!match) {
          throw new ForbiddenException('Acesso negado: lançamento não pertence a você');
        }
      } else if (!podeVer) {
        throw new ForbiddenException('Acesso negado: lançamento não pertence a você');
      }
    }

    const fmt = (d?: Date | null) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
    const valorNum = result.valor ? Number(result.valor) : 0;

    return {
      id: result.id,
      nome: result.nome,
      tipo: result.tipo,
      valor: valorNum,
      // `nome_operador` e `valorString` existem no get-all e faltavam aqui.
      // A tela de inadimplência dá baixa pelo `get` (só tem o id da fatura em
      // mãos) e usa o nome do operador para decidir se precisa pedir
      // justificativa antes de enviar — sem o campo ela achava que NUNCA era
      // auto-aprovação, mandava sem motivo e o servidor recusava com um texto
      // pedindo o motivo que a tela nunca chegou a perguntar.
      nome_operador: result.nome_operador,
      valorString: valorNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      data_vencimento: fmt(result.data_vencimento),
      data: fmt(result.data),
      categoria: result.categoria,
      conta: result.conta,
      descricao: result.descricao,
      cliente: result.cliente,
      forma_pagamento: result.forma_pagamento,
      parcelas: result.parcelas,
      photo: result.photo,
      // Fallback para `photo`: comprovantes antigos foram gravados lá antes
      // da coluna url_comprovante existir.
      url_comprovante: result.url_comprovante ?? result.photo,
      pago: result.pago,
      status: result.status,
      linha_digitavel: result.linha_digitavel,
      pix_copia_cola: result.pix_copia_cola,
    };
  }

  // ==========================================
  // LISTAGEM E AGRUPAMENTO GERAL
  // ==========================================
  async getAll(idCondominio: number, mesStr?: string, anoStr?: string, isSindico: boolean = true, user?: JwtPayload, incluirTaxasCondominiais = false) {
    await this.tenant.assertCondominio(idCondominio, user);

    // Esta rota é a única do módulo que morador consome de verdade (o
    // MoradorFinanceiroView do app): ele vê o livro caixa do prédio com o
    // recorte `pago = 1`. Mas `incluirTaxasCondominiais` chegava pela query
    // string, e ligá-la reinclui as cobranças apto a apto — ou seja, o morador
    // pedia e recebia quanto cada vizinho pagou e quando. Quem decide o
    // recorte é o servidor, pelo papel; a query só pode restringir, nunca
    // ampliar.
    if (!isOperador(user)) incluirTaxasCondominiais = false;
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

    const cond = await this.prisma.condominios.findUnique({
      where: { id: Number(idCondominio) },
      select: { chave_pix: true, categoria_padrao: true },
    });
    const condChavePix = cond?.chave_pix ?? '';

    // Montar intervalo
    const dataIni = new Date(ano, mes - 1, 1);
    const dataFim = new Date(ano, mes, 0); // último dia do mês

    // Apartamentos do condomínio: usados para reconhecer, pelo nome, quais
    // lançamentos são taxa de morador e portanto NÃO pertencem a esta tela.
    const aptosDoCondominio = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      select: { apto: true, bloco: true },
    });

    const whereClause: any = {
      id_condominio: Number(idCondominio),
      OR: [
        { data: { gte: dataIni, lte: dataFim } },
        { data_vencimento: { gte: dataIni, lte: dataFim } },
      ],
      // Conta pessoal do morador (água, luz, internet — criada por ele mesmo
      // via insertMoradorConta, sempre tipo 'D' + id_usuario preenchido) não é
      // dinheiro do condomínio.
      NOT: { AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] },
    };

    if (!isSindico) {
      whereClause.pago = 1;
    }

    const listBruta = await this.prisma.financeiro.findMany({
      where: whereClause,
      orderBy: [{ data: 'asc' }, { data_vencimento: 'asc' }],
    });

    // Taxa de morador (cobrança apto a apto) pertence à aba Inadimplência, não
    // ao livro-caixa do condomínio — são duas telas com finalidades distintas.
    //
    // A exclusão era por `categoria != categoria_padrao`, e bastava esse campo
    // divergir da categoria gravada nas cobranças para TODAS as taxas vazarem
    // para cá (em junho/2026 do Edifício Demo eram 61 de 62 lançamentos).
    // Passa a reconhecer a cobrança do mesmo jeito que a Inadimplência: tipo
    // 'C' cujo nome aponta para um apartamento real. Assim as duas telas usam
    // o mesmo critério e o que entra numa sai da outra, sem depender de um
    // campo de configuração que pode ser renomeado.
    //
    // `incluirTaxasCondominiais` reverte esse filtro — usado quando o síndico
    // quer o livro caixa completo (com arrecadação) para prestar contas numa
    // assembleia, já que sem as taxas o saldo sai artificialmente negativo.
    const list = incluirTaxasCondominiais
      ? listBruta
      : listBruta.filter(
        (l) =>
          !(
            l.tipo === 'C' &&
            aptosDoCondominio.some((a) => this.nomeFaturaDeApto(l.nome, a.apto, a.bloco))
          ),
      );

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
        url_comprovante: item.url_comprovante ?? item.photo,
        linha_digitavel: item.linha_digitavel,
        pix_copia_cola: item.pix_copia_cola,
        // Mesma regra da visão do morador: a chave do condomínio é para
        // RECEBER cobrança (tipo 'C'). Em despesa não faz sentido.
        chave_pix: item.tipo === 'C' ? condChavePix : '',
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
      // Quantas cobranças de taxa ficaram FORA destes totais.
      //
      // O livro caixa esconde as taxas condominiais por padrão (elas vivem na
      // aba Inadimplência), e o resultado na tela é "Total de receitas
      // R$ 0,00" num prédio com dezenas de faturas em aberto — número correto
      // que parece defeito. A única explicação existia num `title` do
      // checkbox, invisível sem passar o mouse. Com a contagem, a tela pode
      // dizer o que está escondendo.
      taxasCondominiaisOcultas: listBruta.length - list.length,
    };
  }

  // ==========================================
  // INADIMPLÊNCIA E TAXAS DE MORADORES
  // ==========================================
  async getAllMoradores(idCondominio: number, mesStr: string, anoStr: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
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
        // Esta tela é a arrecadação: só cobrança de apartamento. Sem o
        // `tipo: 'C'`, a query varria despesa do condomínio e conta pessoal
        // do morador para depois descartar tudo no filtro por nome — e a
        // dívida já renegociada em acordo continuava aparecendo como
        // pendente, do lado das parcelas que a substituíram.
        tipo: 'C',
        ...FinanceiroService.NAO_RENEGOCIADO,
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
      const doApto = financeiroRecords.filter((f) => {
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
      });

      // A tela mostra UMA linha por apartamento, mas o mês pode ter mais de
      // uma cobrança para a mesma unidade (taxa + rateio, taxa + parcela de
      // acordo). Sem ordenação, qual delas aparecia dependia da ordem que o
      // MySQL devolvesse — a mesma tela, recarregada, trocava de linha.
      //
      // Critério: primeiro a que está em aberto (a tela existe para cobrar),
      // depois a de vencimento mais antigo, e o id como desempate final.
      doApto.sort((x, y) => {
        if ((x.pago ?? 0) !== (y.pago ?? 0)) return (x.pago ?? 0) - (y.pago ?? 0);
        const vx = x.data_vencimento?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const vy = y.data_vencimento?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (vx !== vy) return vx - vy;
        return x.id - y.id;
      });
      const fin = doApto[0] ?? null;

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
        status: fin?.status ?? '0',
        url_comprovante: fin?.url_comprovante ?? fin?.photo ?? '',
        mes: mesStr,
        ano: anoStr,
        // Quantas cobranças a unidade tem no mês. `valor` acima continua sendo
        // só o da cobrança exibida — somar aqui faria o formulário de edição
        // gravar o total numa cobrança só. Serve para a tela avisar que há
        // mais de uma e mandar o síndico para a Inadimplência.
        qtd_cobrancas: doApto.length,
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
    await this.tenant.assertCondominio(idCondominio, user);
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
        valor: { gt: 0 }, // Cobrança de R$ 0,00 não é dívida
        ...FinanceiroService.NAO_RENEGOCIADO,
      },
      select: { nome: true, data_vencimento: true },
    });

    const blocosMap: Record<string, any[]> = {};
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    for (const a of aptos) {
      const minhasPendentes = faturasPendentes.filter((f) =>
        this.nomeFaturaDeApto(f.nome, a.apto, a.bloco)
      );

      const devendoCount = minhasPendentes.length;
      const blocoKey = a.bloco || 'Sem Bloco';
      if (devendoCount > 0) {
        let atrasadas = 0;
        let aVencer = 0;

        for (const f of minhasPendentes) {
          const dataVenc = f.data_vencimento ? new Date(f.data_vencimento) : null;
          if (dataVenc) {
            dataVenc.setHours(0, 0, 0, 0);
          }
          if (dataVenc && dataVenc < hoje) {
            atrasadas++;
          } else {
            aVencer++;
          }
        }

        if (!blocosMap[blocoKey]) blocosMap[blocoKey] = [];
        blocosMap[blocoKey].push({
          bloco: blocoKey,
          apto: a.apto,
          qtd: devendoCount,
          atrasadas,
          aVencer,
        });
      }
    }

    const listBlocos = Object.keys(blocosMap).map(b => ({
      bloco: b,
      aptos: blocosMap[b],
    }));

    return { blocos: listBlocos };
  }

  /**
   * Dashboard de Inadimplência (síndico): resumo (cards), feed de eventos
   * (pagamentos recebidos / cobranças vencidas) e a lista por bloco — tudo
   * baseado nas cobranças de taxa dos moradores (categoria_padrao), que NÃO
   * aparecem mais no Financeiro do condomínio.
   */
  async getInadimplenciaDashboard(idCondominio: number, mesStr?: string, anoStr?: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);

    const mesesDisponiveis = await this.getAllMeses(idCondominio);
    let mes = mesStr ? Number(mesStr) : new Date().getMonth() + 1;
    let ano = anoStr ? Number(anoStr) : new Date().getFullYear();
    if (mesesDisponiveis.length > 0 && (!mesStr || !anoStr)) {
      const ult = mesesDisponiveis[mesesDisponiveis.length - 1];
      mes = Number(ult.mes);
      ano = Number(ult.ano);
    }

    const dataIni = new Date(ano, mes - 1, 1);
    const dataFim = new Date(ano, mes, 0);

    // Cobranças de apartamento no mês (por vencimento ou data). Valor 0 fica de
    // fora: não é arrecadação nem dívida — só poluiria os cards e o feed.
    //
    // A cobrança é identificada como no restante do módulo: tipo 'C' cujo nome
    // aponta para um apartamento REAL do condomínio ("Apto X Bloco Y - ...").
    // Antes o filtro era `categoria = categoria_padrao`, e bastava esse campo
    // divergir da categoria gravada nas cobranças para os cards zerarem — a
    // lista por bloco, logo abaixo, continuava mostrando as mesmas dívidas
    // porque já usava este critério. Os dois passam a enxergar o mesmo dado.
    const aptosDoCondominio = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      select: { apto: true, bloco: true },
    });

    const cobrancasDoMes = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        tipo: 'C',
        valor: { gt: 0 },
        ...FinanceiroService.NAO_RENEGOCIADO,
        OR: [
          { data: { gte: dataIni, lte: dataFim } },
          { data_vencimento: { gte: dataIni, lte: dataFim } },
        ],
      },
      orderBy: [{ updated_at: 'desc' }],
    });

    const cobrancas = cobrancasDoMes.filter((c) =>
      aptosDoCondominio.some((a) => this.nomeFaturaDeApto(c.nome, a.apto, a.bloco)),
    );

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let totalArrecadado = 0;
    let totalPendente = 0;
    let qtdPagas = 0;
    let qtdPendentes = 0;
    const aptosDevendo = new Set<string>();
    // Listas detalhadas (drill-down dos cards).
    const fmt0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const extrair0 = (nome: string | null) => {
      const m = /\bApto\s+(\S+)/i.exec(nome || '');
      const b = /\bBloco\s+(\S+)/i.exec(nome || '');
      return { apto: m ? m[1] : '', bloco: b ? b[1] : '' };
    };
    const pagas: any[] = [];
    const pendentes: any[] = [];
    const aptosMap = new Map<string, { apto: string; bloco: string; qtd: number; total: number }>();

    for (const c of cobrancas) {
      const v = c.valor ? Math.abs(Number(c.valor)) : 0;
      const { apto, bloco } = extrair0(c.nome);
      const item = {
        id: c.id,
        nome: c.nome,
        apto,
        bloco,
        valor: v,
        valorString: fmt0(v),
        data_vencimento: c.data_vencimento ? new Date(c.data_vencimento).toLocaleDateString('pt-BR') : '',
        pago: c.pago,
        status: c.status,
      };
      if (c.pago === 1) {
        totalArrecadado += v;
        qtdPagas++;
        pagas.push(item);
      } else {
        totalPendente += v;
        qtdPendentes++;
        pendentes.push(item);
        const key = `${bloco}-${apto || c.id}`;
        aptosDevendo.add(key);
        const ex = aptosMap.get(key) ?? { apto, bloco, qtd: 0, total: 0 };
        ex.qtd++;
        ex.total += v;
        aptosMap.set(key, ex);
      }
    }
    const aptosDevendoList = Array.from(aptosMap.values())
      .map((a) => ({ ...a, totalString: fmt0(a.total) }))
      .sort((a, b) => b.total - a.total);

    const totalAptos = await this.prisma.apartamentos.count({
      where: { id_condominio: Number(idCondominio) },
    });
    const percInadimplencia = totalAptos > 0
      ? Math.round((aptosDevendo.size / totalAptos) * 1000) / 10
      : 0;

    const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Feed de eventos: pagamentos recebidos + cobranças vencidas (aproximação a
    // partir de pago/updated_at/data_vencimento — não há tabela de auditoria).
    const extrairApto = (nome: string | null) => {
      const m = /\bApto\s+(\S+)/i.exec(nome || '');
      const b = /\bBloco\s+(\S+)/i.exec(nome || '');
      return { apto: m ? m[1] : '', bloco: b ? b[1] : '' };
    };
    const eventos = cobrancas
      .map((c) => {
        const v = c.valor ? Math.abs(Number(c.valor)) : 0;
        const { apto, bloco } = extrairApto(c.nome);
        const venc = c.data_vencimento ? new Date(c.data_vencimento) : null;
        if (venc) venc.setHours(0, 0, 0, 0);
        let tipo: 'pagamento' | 'vencido' | 'gerada';
        let data: Date | null;
        if (c.pago === 1) {
          tipo = 'pagamento';
          data = c.updated_at ?? c.data ?? null;
        } else if (venc && venc < hoje) {
          tipo = 'vencido';
          data = venc;
        } else {
          tipo = 'gerada';
          data = c.created_at ?? null;
        }
        return {
          tipo,
          nome: c.nome,
          apto,
          bloco,
          valor: v,
          valorString: fmt(v),
          data: data ? data.toLocaleDateString('pt-BR') : '',
          dataOrd: data ? data.getTime() : 0,
        };
      })
      .sort((a, b) => b.dataOrd - a.dataOrd)
      .slice(0, 30);

    // Lista por bloco (reusa a agregação existente).
    const { blocos } = await this.getAllInadimplentes(idCondominio, user);

    return {
      resumo: {
        totalArrecadado: fmt(totalArrecadado),
        totalPendente: fmt(totalPendente),
        qtdPagas,
        qtdPendentes,
        qtdAptosDevendo: aptosDevendo.size,
        totalAptos,
        percInadimplencia,
      },
      eventos,
      blocos,
      pagas,
      pendentes,
      aptosDevendo: aptosDevendoList,
      meses: mesesDisponiveis,
    };
  }

  async getInadimplenteDetail(idCondominio: number, apto: string, bloco: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
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
          pago: 0,
          pix_copia_cola: '',
          status: '0',
          url_comprovante: '',
        },
        {
          mes: '04',
          ano: '2026',
          periodo: 'Abril/2026',
          valor: 650,
          valorString: 'R$ 650,00',
          nome: `Apto ${apto} Bloco ${bloco} - Ref. 04/2026`,
          data_vencimento: '10/04/2026',
          pago: 0,
          pix_copia_cola: '',
          status: '0',
          url_comprovante: '',
        }
      ];
    }

    const candidatas = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        tipo: 'C', // Apenas Receitas (cobranças) pendentes
        valor: { gt: 0 }, // Cobrança de R$ 0,00 não é dívida
        ...FinanceiroService.NAO_RENEGOCIADO,
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

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const dataVenc = f.data_vencimento ? new Date(f.data_vencimento) : null;
      if (dataVenc) {
        dataVenc.setHours(0, 0, 0, 0);
      }
      const atrasado = dataVenc ? dataVenc < hoje : false;

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
        atrasado,
        pix_copia_cola: f.pix_copia_cola ?? '',
        status: f.status,
        url_comprovante: f.url_comprovante ?? f.photo ?? '',
      };
    });

    return faturasDevendo;
  }

  async notifyInadimplente(idCondominio: number, apto: string, bloco: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
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
            pendingFaturas.length > 1 ? `${pendingFaturas.length} faturas pendentes (Acumulado)` : (maisAntiga.nome || ''),
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
    await this.tenant.assertCondominio(idCondominio, user);
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
        // Mesmo recorte do getAll: sem isso, as contas pessoais dos moradores
        // entravam no gráfico do síndico e criavam categorias de despesa
        // ("Água", "Luz", "Internet") que não são do condomínio — o gráfico
        // não fechava com o livro caixa da mesma tela.
        NOT: { AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] },
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

  async getByUser(idUser: number, idCondominio: number, user?: JwtPayload) {
    // Sem esta checagem o condomínio vinha só do query string: staff de um
    // condomínio lia o financeiro de qualquer outro trocando id_condominio
    // (o restante do módulo já valida; este método tinha ficado de fora).
    await this.tenant.assertCondominio(idCondominio, user);

    if (!this.prisma.isConnected) {
      return [
        {
          id: 1, nome: 'Taxa de Condomínio - Maio', tipo: 'C', valorReal: 'R$ 650,00',
          data_vencimento: '10/05/2026', data: '10/05/2026', pago: 1,
          url_boleto: 'https://example.com/boleto.pdf', url_comprovante: '', status: '1',
          id_usuario: null, categoria: 'Condomínio', chave_pix: 'sindico@pix.com'
        },
      ];
    }

    // Busca a chave Pix do condomínio
    const cond = await this.prisma.condominios.findUnique({
      where: { id: Number(idCondominio) },
      select: { chave_pix: true },
    });
    const condChavePix = cond?.chave_pix ?? '';

    // Vínculos de apartamento do morador NESTE condomínio. O filtro por
    // condomínio é obrigatório: quem mora em dois prédios costuma ter a mesma
    // numeração ("Apto 101 Bloco A") nos dois, e sem ele a unidade do prédio B
    // casava com a cobrança do prédio A — que é de outra família.
    const moradoresList = await this.prisma.moradores.findMany({
      where: { id_user: Number(idUser), id_condominio: Number(idCondominio) },
    });

    const auList = await this.prisma.apartamentos_Users.findMany({
      where: {
        id_user: Number(idUser),
        apartamento: { id_condominio: Number(idCondominio) },
      },
      include: { apartamento: true },
    });

    const userUnits = [
      ...moradoresList.map(m => ({ bloco: m.bloco, apartamento: m.apartamento })),
      ...auList.map(au => ({ bloco: au.apartamento?.bloco, apartamento: au.apartamento?.apto })),
    ].filter(unit => unit.apartamento != null && unit.apartamento !== '');

    const list = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        // Dívida renegociada em acordo foi substituída pelas parcelas: mostrar
        // as duas fazia o morador ver o dobro do que realmente deve.
        ...FinanceiroService.NAO_RENEGOCIADO,
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
        // "Cobrança de R$ 0,00 não é dívida" — regra que a inadimplência do
        // síndico aplica em três consultas e esta não aplicava. O job de
        // recorrência gerou cobranças zeradas antes da validação de valor
        // existir, e elas ficaram visíveis SÓ para o morador: ele abria o app
        // e via uma pendência de R$ 0,00 que o síndico não enxergava em lugar
        // nenhum, então não tinha como explicar nem dar baixa.
        //
        // Vale só para cobrança do condomínio: conta pessoal do morador
        // (id_usuario, tratada acima) continua aparecendo mesmo zerada — é
        // dele, e ele precisa poder ver para corrigir ou apagar.
        if (!(Number(item.valor) > 0)) return false;

        const match = userUnits.some(m =>
          this.nomeFaturaDeApto(item.nome, m.apartamento, m.bloco)
        );
        if (!match) {
          this.logger.debug(`[getByUser] item ID=${item.id} nome="${item.nome}" NÃO bateu com nenhum apartamento do morador ${idUser} (${userUnits.map(m => `${m.apartamento}/${m.bloco}`).join(', ')})`);
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
      url_comprovante: item.url_comprovante ?? item.photo ?? '',
      status: item.status ?? '0',
      linha_digitavel: item.linha_digitavel ?? '',
      pix_copia_cola: item.pix_copia_cola ?? '',
      id_usuario: item.id_usuario,
      categoria: item.categoria ?? 'Outros',
      // A chave Pix do condomínio só vale para o que o morador deve AO
      // condomínio (tipo 'C'). Numa conta pessoal — água, luz, internet, que
      // ele mesmo lançou — ela não tem relação nenhuma com o pagamento, e o
      // app oferecia "Copiar Pix" com a chave do prédio.
      chave_pix: item.tipo === 'C' ? condChavePix : '',
    }));
  }

  async uploadSharedFile(id: number, fileBase64: string, type: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { url: '' };

    // Sem essa checagem, qualquer um anexa boleto/comprovante a lançamento alheio.
    const lanc = await this.getLancamentoForTenant(id, user);

    // Morador só pode anexar comprovante a lançamento dele próprio (id_usuario).
    const isMorador = user?.typeAccess === 'Morador';
    if (isMorador) {
      const userId = Number(user?.sub ?? user?.user?.id);
      if (lanc.id_usuario) {
        if (Number(lanc.id_usuario) !== userId) {
          throw new ForbiddenException('Você só pode anexar arquivo a um lançamento seu');
        }
      } else {
        // Cobrança de condomínio não tem id_usuario. Antes isso liberava anexar
        // em qualquer fatura do condomínio — inclusive de outra unidade, dando
        // para sobrescrever o comprovante do vizinho. Confere o apartamento.
        const ehDaMinhaUnidade = await this.lancamentoEhDaUnidadeDoMorador(
          lanc.nome,
          userId,
          lanc.id_condominio,
        );
        if (!ehDaMinhaUnidade) {
          throw new ForbiddenException('Você só pode anexar arquivo a um lançamento seu');
        }
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
        // comprovante, seta status = 2 (aguardando auditoria do sindico).
        // Coluna própria: antes gravava em `photo` e sobrescrevia a foto
        // da despesa quando o lançamento tinha as duas coisas.
        await this.prisma.financeiro.update({
          where: { id: Number(id) },
          data: { url_comprovante: url, status: '2' },
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
    // Em cobrança da Superlógica, quem dá a baixa é o ERP (arquivo de retorno
    // do banco). Marcar pago aqui duraria até o próximo sync e sumiria.
    this.assertLancamentoEditavel(lanc, 'baixado');

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
      // O `code` deixa a recusa legível por máquina: quem chama abre o modal de
      // justificativa em vez de só pintar a mensagem na tela. O cliente adivinha
      // a auto-aprovação para abrir o modal antes de enviar, mas quem decide é
      // este bloco — o front pode errar o palpite (nome do operador ausente na
      // resposta, lançamento criado sob outro nome) e o fluxo tem que se
      // recuperar em vez de virar um beco sem saída.
      const motivo = extras?.motivo?.trim();
      if (!motivo || motivo.length < 5) {
        throw new BadRequestException({
          code: 'AUTO_APROVACAO_EXIGE_JUSTIFICATIVA',
          message:
            'Para marcar como pago um lançamento que você mesmo criou, informe o motivo (ex: "Pago em dinheiro pelo morador", "PIX recebido na conta do síndico"). Mínimo 5 caracteres.',
        });
      }
      if (!extras?.formaPagamento) {
        throw new BadRequestException({
          code: 'AUTO_APROVACAO_EXIGE_JUSTIFICATIVA',
          message:
            'Informe a forma de pagamento (PIX, dinheiro, transferência, etc.) ao marcar como pago um lançamento que você mesmo criou.',
        });
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

    // Aceita `financeiro_<id>` e `financeiro_<id>_v<timestamp>` — a segunda
    // forma é usada quando o valor da cobrança é corrigido e o Pix precisa ser
    // reemitido (a OpenPix recusa reaproveitar um correlationID).
    const financeiroId = Number(/^financeiro_(\d+)/.exec(correlationID)?.[1] ?? 0);
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
      detalhes: {
        event: body.event,
        valorRecebido,
        valorEsperado,
        correlationID,
      },
    });

    return { success: true };
  }

  async createRateio(idCondominio: number, rateioData: { nome: string; valorTotal: number; data_vencimento: string; categoria: string }, operatorName: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const valorTotal = this.parseValorMonetario(rateioData.valorTotal);
    if (!(valorTotal > 0) || valorTotal > 9999999) {
      throw new BadRequestException('O valor total do rateio deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

    const todosAptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
    });

    // Unidade fantasma ("Apto 000 Bloco Condominio") não recebe cobrança — a
    // recorrência já pulava, o rateio não. Além de gerar uma dívida que nunca
    // será paga, ela entrava no divisor e diluía o valor de todo mundo, então
    // a soma das cobranças não fechava com o total do rateio.
    const aptos = todosAptos.filter((a) => !this.isUnidadeFantasma(a.apto, a.bloco));

    if (aptos.length === 0) return { success: false, message: 'Nenhum apartamento cadastrado.' };

    const dVenc = this.parseDataBR(rateioData.data_vencimento);

    // Rateio é lançamento novo: respeita competência fechada como o insert.
    await this.fechamento.assertPodeAlterar(
      Number(idCondominio),
      dVenc,
      'insert',
      `Rateio: ${rateioData.nome}`,
    );

    // Divisão em centavos: R$ 10.000 entre 62 aptos dá 161,290322… e o
    // DECIMAL(10,2) arredonda cada parcela. A soma ficava alguns centavos
    // abaixo do total e o síndico não fechava a prestação de contas do
    // rateio. Os centavos que sobram vão para a primeira unidade.
    const centavosTotais = Math.round(valorTotal * 100);
    const centavosBase = Math.floor(centavosTotais / aptos.length);
    const centavosSobra = centavosTotais - centavosBase * aptos.length;
    const valorDoApto = (indice: number) =>
      (centavosBase + (indice < centavosSobra ? 1 : 0)) / 100;

    // Transação: rateio é all-or-nothing. Se cair na metade, alguns aptos
    // ficavam com cobrança e outros não, sem operador saber.
    const createdCharges = await this.prisma.$transaction(
      aptos.map((apto, i) =>
        this.prisma.financeiro.create({
          data: {
            nome: `Apto ${apto.apto} Bloco ${apto.bloco} - Rateio: ${rateioData.nome}`,
            tipo: 'C',
            valor: valorDoApto(i),
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
    createdCharges.forEach((charge, i) => {
      this.openPix.generateCharge(`financeiro_${charge.id}`, valorDoApto(i), charge.nome ?? 'Rateio', dVenc)
        .then(async (pixData) => {
          if (pixData?.brCode) {
            await this.prisma.financeiro.update({
              where: { id: charge.id },
              data: { pix_copia_cola: pixData.brCode },
            });
          }
        })
        .catch((e) => this.logger.error(`Failed to generate OpenPix for rateio charge ${charge.id}: ${e}`));
    });

    const valorPorApto = valorDoApto(aptos.length - 1); // sem o centavo de sobra
    const unidadesIgnoradas = todosAptos.length - aptos.length;

    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'CREATE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Criou rateio "${rateioData.nome}" — ${formatReal(valorTotal)} dividido em ${aptos.length} aptos (${formatReal(valorPorApto)} cada)`,
      detalhes: {
        rateio: {
          nome: rateioData.nome,
          categoria: rateioData.categoria,
          valorTotal,
          valorTotalFormatado: formatReal(valorTotal),
          valorPorApto,
          valorPorAptoFormatado: formatReal(valorPorApto),
          // Quando não divide exato, a primeira unidade absorve os centavos
          // que sobram — fica registrado para o síndico conferir.
          centavosDeSobra: centavosSobra,
          dataVencimento: rateioData.data_vencimento,
          quantidadeAptos: aptos.length,
          unidadesInvalidasIgnoradas: unidadesIgnoradas,
          aptos: aptos.slice(0, 20).map((a) => `${a.bloco}-${a.apto}`),
        },
      },
    });

    return { success: true, count: createdCharges.length, message: `Cobrança rateada criada para ${createdCharges.length} apartamentos.` };
  }

  async createAcordoInadimplente(idCondominio: number, acordoData: { apto: string; bloco: string; parcelas: number; valorTotal: number }, operatorName: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    // Sem estas guardas, `valorTotal / parcelas` produzia Infinity (parcelas
    // 0), NaN (parcelas ausente) ou parcela negativa — e o Prisma gravava
    // cobranças impagáveis no lugar da dívida real, que já tinha sido marcada
    // como renegociada na mesma transação.
    const parcelas = Math.trunc(Number(acordoData.parcelas));
    if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > 60) {
      throw new BadRequestException('Informe o número de parcelas do acordo (de 1 a 60).');
    }
    const valorTotal = this.parseValorMonetario(acordoData.valorTotal);
    if (!(valorTotal > 0) || valorTotal > 9999999) {
      throw new BadRequestException('O valor total do acordo deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

    // Busca débitos com filtro amplo (contains) mas FILTRA na aplicação
    // com match exato. Sem isso, "Apto 10 Bloco A" pegava TAMBÉM débitos de
    // "Apto 100/101/1010 Bloco A" e renegociava em lote — apaga dívidas
    // de outros apartamentos.
    const candidatos = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        // Débito já renegociado não entra num segundo acordo: senão as
        // parcelas do acordo anterior viravam base do novo, inflando a dívida
        // a cada renegociação.
        ...FinanceiroService.NAO_RENEGOCIADO,
        nome: {
          contains: `Apto ${acordoData.apto} Bloco ${acordoData.bloco}`,
        },
      },
    });

    const debitos = candidatos.filter((d) =>
      this.nomeFaturaDeApto(d.nome, acordoData.apto, acordoData.bloco)
    );

    if (debitos.length === 0) return { success: false, message: 'Nenhum débito em aberto encontrado.' };

    const hoje = new Date();

    // Parcelamento em centavos: 1.000,00 em 3x dá 333,333… e o DECIMAL(10,2)
    // arredondava cada parcela — o acordo fechava em 999,99 e sobrava um
    // centavo de dívida. A sobra vai para a primeira parcela.
    const centavosTotais = Math.round(valorTotal * 100);
    const centavosBase = Math.floor(centavosTotais / parcelas);
    const centavosSobra = centavosTotais - centavosBase * parcelas;
    const valorDaParcela = (i: number) => (centavosBase + (i <= centavosSobra ? 1 : 0)) / 100;

    // Transação: renegociar débitos e criar parcelas é all-or-nothing.
    // Sem isso, fica débito como "renegociado" sem as parcelas correspondentes.
    const parcelasOperations = [];
    for (let i = 1; i <= parcelas; i++) {
      const vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + i, 10);
      parcelasOperations.push(
        this.prisma.financeiro.create({
          data: {
            nome: `Apto ${acordoData.apto} Bloco ${acordoData.bloco} - Acordo Parc. ${i}/${parcelas}`,
            tipo: 'C',
            valor: valorDaParcela(i),
            data_vencimento: vencimento,
            categoria: 'Acordo',
            descricao: `Acordo de débitos anteriores parcelado pelo síndico. Parcela ${i} de ${parcelas}`,
            nome_operador: operatorName,
            id_condominio: Number(idCondominio),
            pago: 0,
            status: '0',
          },
        }),
      );
    }

    const resultados = await this.prisma.$transaction([
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

    // Pix das parcelas, em background — rateio e recorrência já geravam, o
    // acordo não: o morador que renegociava ficava com parcelas sem nenhuma
    // forma de pagar pelo app, justamente quem mais precisa quitar.
    const parcelasCriadas = resultados.slice(debitos.length);
    parcelasCriadas.forEach((parcela: any, idx) => {
      this.openPix
        .generateCharge(
          `financeiro_${parcela.id}`,
          valorDaParcela(idx + 1),
          parcela.nome ?? 'Parcela de acordo',
          parcela.data_vencimento,
        )
        .then(async (pixData) => {
          if (pixData?.brCode) {
            await this.prisma.financeiro.update({
              where: { id: parcela.id },
              data: { pix_copia_cola: pixData.brCode },
            });
          }
        })
        .catch((e) =>
          this.logger.error(`Failed to generate OpenPix for acordo parcela ${parcela.id}: ${e}`),
        );
    });

    const valorParcela = valorDaParcela(parcelas); // sem o centavo de sobra
    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'CREATE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Acordo de inadimplência: Apto ${acordoData.apto} Bloco ${acordoData.bloco} — ${formatReal(valorTotal)} em ${parcelas}x de ${formatReal(valorParcela)}`,
      detalhes: {
        acordo: {
          apto: acordoData.apto,
          bloco: acordoData.bloco,
          valorTotal,
          valorTotalFormatado: formatReal(valorTotal),
          parcelas,
          valorParcela,
          valorParcelaFormatado: formatReal(valorParcela),
          centavosDeSobra: centavosSobra,
          debitosOriginaisRenegociados: debitos.length,
          debitosOriginais: debitos.map((d) => ({ id: d.id, nome: d.nome, valor: Number(d.valor) })),
        },
      },
    });

    return { success: true, message: `Acordo firmado com sucesso em ${parcelas} parcelas de ${formatReal(valorParcela)}.` };
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
        // Idem: dívida renegociada não gera lembrete de vencimento.
        ...FinanceiroService.NAO_RENEGOCIADO,
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
  async insertMoradorConta(idUser: number, idCondominio: number, data: any, user?: JwtPayload) {
    // O condomínio vinha só do body: dava para criar conta pessoal dentro de
    // condomínio alheio, poluindo o financeiro de outro tenant.
    await this.tenant.assertCondominio(idCondominio, user);

    if (!this.prisma.isConnected) return { success: true };

    // A taxa de condomínio é gerada pelo síndico. Este método é o "morador
    // lança a própria despesa", então aceitar categoria de condomínio deixaria
    // o morador forjar a própria cobrança — e agora há mais de um chamador
    // (formulário do app e assistente), então a regra fica aqui, não na tela.
    const catNormalizada = String(data.categoria ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    if (catNormalizada === 'condominio' || catNormalizada === 'taxa condominial') {
      throw new BadRequestException(
        'A taxa de condomínio é lançada pelo síndico e não pode ser criada como conta pessoal.',
      );
    }

    const valor = this.parseValorMonetario(data.valor);
    if (valor <= 0 || valor > 9999999) {
      throw new BadRequestException('O valor da conta deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

    const dVenc = this.parseDataBR(data.data_vencimento);

    // Mesmo padrao do insert principal: protege contra erros de runtime
    // (Decimal/Prisma) que vazariam mensagens JS internas pro cliente.
    let criado;
    try {
      criado = await this.prisma.financeiro.create({
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
          ...(data.linha_digitavel ? { linha_digitavel: data.linha_digitavel } : {}),
          ...(data.pix_copia_cola ? { pix_copia_cola: data.pix_copia_cola } : {}),
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

    return { success: true, id: criado.id };
  }

  /**
   * Filtro que define "conta pessoal do morador": lançamento tipo 'D' criado
   * por ele mesmo (água, luz, internet), amarrado ao id_usuario.
   *
   * A cobrança do condomínio TAMBÉM ganha id_usuario — o `insert` do síndico
   * resolve o morador pelo "Apto X Bloco Y" do nome. Sem o `tipo: 'D'` aqui,
   * as rotas /financeiro/morador/* deixavam o morador editar o valor, marcar
   * como paga ou APAGAR a própria taxa condominial pela API (a UI não mostra
   * os botões, mas a rota aceitava o id, que ele lê em /get-by-user).
   */
  private contaPessoalDoMorador(idUser: number, id: number, idCondominio?: number) {
    return {
      id: Number(id),
      id_usuario: Number(idUser),
      tipo: 'D',
      ...(idCondominio ? { id_condominio: Number(idCondominio) } : {}),
    };
  }

  async updateMoradorConta(idUser: number, idCondominio: number, data: any) {
    if (!this.prisma.isConnected) return { success: true };

    const record = await this.prisma.financeiro.findFirst({
      where: this.contaPessoalDoMorador(idUser, Number(data.id), idCondominio),
    });

    if (!record) throw new NotFoundException('Conta não encontrada ou sem permissão.');

    const valor = this.parseValorMonetario(data.valor);
    if (valor <= 0 || valor > 9999999) {
      throw new BadRequestException('O valor da conta deve ser maior que zero e menor que R$ 10.000.000,00.');
    }

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
          ...(data.linha_digitavel !== undefined ? { linha_digitavel: data.linha_digitavel } : {}),
          ...(data.pix_copia_cola !== undefined ? { pix_copia_cola: data.pix_copia_cola } : {}),
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
      where: this.contaPessoalDoMorador(idUser, id),
    });

    if (!record) throw new NotFoundException('Conta não encontrada ou sem permissão.');

    await this.prisma.financeiro.delete({
      where: { id: Number(id) },
    });

    return { success: true };
  }

  async parseOfxContent(idCondominio: number, ofxContent: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
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
        // A conciliação bancária é do extrato do CONDOMÍNIO. As contas pessoais
        // do morador (tipo 'D' + id_usuario) apareciam na lista de sugestões —
        // o operador via a conta de luz da casa dele e podia dar baixa nela.
        NOT: { AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] },
        // Dívida renegociada em acordo foi substituída pelas parcelas e não é
        // mais cobrável. Ela continuava aparecendo aqui como sugestão: o
        // depósito do morador casava com o débito ORIGINAL, o síndico
        // confirmava, e o pagamento era creditado numa dívida que não existe
        // mais — enquanto a parcela do acordo, essa sim viva, seguia em aberto.
        // Todas as outras leituras de dívida em aberto já filtravam; a
        // conciliação era a que faltava.
        ...FinanceiroService.NAO_RENEGOCIADO,
      },
    });

    // Um lançamento só pode ser sugerido para UMA transação do extrato.
    //
    // Sem isso, o caso normal do condomínio quebrava: 40 moradores pagando a
    // mesma taxa de R$ 650 geram 40 linhas idênticas no OFX, e todas casavam
    // com a MESMA primeira cobrança em aberto. A tela mostrava 40 sugestões
    // apontando para o Apto 101, o síndico confirmava, e o resultado era uma
    // cobrança baixada 40 vezes enquanto 39 pagamentos reais ficavam em
    // aberto — exatamente o trabalho que a conciliação deveria eliminar.
    const jaSugeridos = new Set<number>();

    const results = transactions.map(tx => {
      const txType = tx.amount < 0 ? 'D' : 'C';
      const absAmount = Math.abs(tx.amount);

      let bestMatch: any = null;
      let matchType: 'exact' | 'partial' | 'none' = 'none';

      const mesmoValor = unpaid.filter(db => {
        if (jaSugeridos.has(db.id)) return false;
        const dbType = db.tipo || 'C';
        const dbAmt = Math.abs(Number(db.valor || 0));
        return dbType === txType && Math.abs(dbAmt - absAmount) <= 0.01;
      });

      const distanciaEmDias = (db: any) => {
        const dbDate = db.data_vencimento || db.data;
        if (!dbDate) return Number.MAX_SAFE_INTEGER;
        return Math.abs(dbDate.getTime() - tx.date.getTime()) / (1000 * 60 * 60 * 24);
      };

      // Entre os candidatos de mesmo valor, o de vencimento mais próximo da
      // data do extrato — antes era o primeiro que o banco devolvesse.
      const exactMatches = mesmoValor
        .filter(db => distanciaEmDias(db) <= 5)
        .sort((a, b) => distanciaEmDias(a) - distanciaEmDias(b));

      if (exactMatches.length > 0) {
        bestMatch = exactMatches[0];
        matchType = 'exact';
      } else if (mesmoValor.length > 0) {
        bestMatch = [...mesmoValor].sort((a, b) => distanciaEmDias(a) - distanciaEmDias(b))[0];
        matchType = 'partial';
      }

      if (bestMatch) jaSugeridos.add(bestMatch.id);

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

  async confirmarConciliacao(idCondominio: number, reconciliationsBrutas: { databaseId: number; dataPagamento: string }[], user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);

    // Deduplica por lançamento: se a tela mandar o mesmo id em duas linhas do
    // extrato, o relatório final diria "2 lançamentos confirmados" tendo
    // baixado um só, e o síndico acharia que dois moradores pagaram.
    const vistos = new Set<number>();
    const reconciliations = (reconciliationsBrutas ?? []).filter((r) => {
      const id = Number(r?.databaseId);
      if (!id || vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
    // Cada databaseId precisa pertencer ao condomínio — sem isso, atacante
    // marca como pago lançamentos de outros condomínios em massa. Também
    // bloqueia conciliar lançamento de competência fechada, igual updateStatus
    // (mesma exceção: cobrança de morador atrasada passa mesmo assim).
    for (const rec of reconciliations) {
      const lanc = await this.getLancamentoForTenant(rec.databaseId, user);
      this.assertLancamentoEditavel(lanc, 'conciliado');
      await this.fechamento.assertPodeAlterar(
        lanc.id_condominio,
        lanc.data ?? lanc.data_vencimento,
        'updateStatus',
        lanc.nome,
      );
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
    incluirTaxasCondominiais = false,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.tenant.assertCondominio(idCondominio, user);
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

    const listBruta = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        OR: [
          { data: { gte: dataIni, lte: dataFim } },
          { data_vencimento: { gte: dataIni, lte: dataFim } },
        ],
        // Conta pessoal do morador (água, luz, internet que ele mesmo lançou:
        // tipo 'D' + id_usuario) não é dinheiro do condomínio e não pode sair
        // no livro caixa — o síndico exportava o CSV e lia as contas de casa
        // de cada morador. Mesmo critério do getAll.
        NOT: { AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] },
      },
      orderBy: [{ data: 'asc' }, { data_vencimento: 'asc' }],
    });

    // Mesmo critério de exclusão de taxa condominial usado no getAll (tela) —
    // por padrão o CSV fica consistente com o que o síndico vê na tela;
    // `incluirTaxasCondominiais` reinclui pra fechar o livro caixa completo.
    const aptosDoCondominio = incluirTaxasCondominiais
      ? []
      : await this.prisma.apartamentos.findMany({
        where: { id_condominio: Number(idCondominio) },
        select: { apto: true, bloco: true },
      });
    const list = incluirTaxasCondominiais
      ? listBruta
      : listBruta.filter(
        (l) =>
          !(
            l.tipo === 'C' &&
            aptosDoCondominio.some((a) => this.nomeFaturaDeApto(l.nome, a.apto, a.bloco))
          ),
      );

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
    await this.tenant.assertCondominio(idCondominio, user);
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
        mes_inicio_recorrencia: true,
        ano_inicio_recorrencia: true,
        chave_pix: true,
      },
    });

    return cond;
  }

  async updateConfigAuto(idCondominio: number, config: any, operatorName: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    // Ativar recorrência exige valor de taxa > 0 — sem isso o job geraria
    // faturas de R$ 0,00 para todos os aptos. Valida contra o valor enviado
    // ou, se não enviado, contra o já salvo no condomínio.
    if (config.recorrencia_ativa) {
      let valorCfg: number;
      if (config.valor_condominio !== undefined) {
        valorCfg = Number(config.valor_condominio);
      } else {
        const atual = await this.prisma.condominios.findUnique({
          where: { id: Number(idCondominio) },
          select: { valor_condominio: true },
        });
        valorCfg = Number(atual?.valor_condominio ?? 0);
      }
      if (!(valorCfg > 0)) {
        throw new BadRequestException(
          'Para ativar a recorrência, informe o valor da taxa condominial (maior que zero).',
        );
      }
    }

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
        mes_inicio_recorrencia: config.mes_inicio_recorrencia !== undefined ? (config.mes_inicio_recorrencia ? Number(config.mes_inicio_recorrencia) : null) : undefined,
        ano_inicio_recorrencia: config.ano_inicio_recorrencia !== undefined ? (config.ano_inicio_recorrencia ? Number(config.ano_inicio_recorrencia) : null) : undefined,
        chave_pix: config.chave_pix !== undefined ? (config.chave_pix ? String(config.chave_pix) : null) : undefined,
      },
    });

    // Se a recorrência foi ativada, gera as faturas imediatamente para o mês configurado (se for mês atual ou passado)
    if (updated.recorrencia_ativa) {
      const hoje = new Date();
      const anoAtual = hoje.getFullYear();
      const mesAtual = hoje.getMonth() + 1;

      const mesTarget = updated.mes_inicio_recorrencia !== null ? updated.mes_inicio_recorrencia : mesAtual;
      const anoTarget = updated.ano_inicio_recorrencia !== null ? updated.ano_inicio_recorrencia : anoAtual;

      if (anoTarget < anoAtual || (anoTarget === anoAtual && mesTarget <= mesAtual)) {
        this.gerarFaturasRecorrentesParaMes(updated.id, mesTarget, anoTarget, true)
          .then(() => {
            this.logger.log(`[updateConfigAuto] Faturamento automático inicial gerado com sucesso para condomínio ${idCondominio} Ref. ${mesTarget}/${anoTarget}`);
          })
          .catch((err) => {
            this.logger.error(`[updateConfigAuto] Erro ao gerar faturamento automático inicial para condomínio ${idCondominio}: ${err}`);
          });
      }
    }

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

  async getApartamentosConfig(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return [];

    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      select: {
        id: true,
        apto: true,
        bloco: true,
        ignorar_recorrencia: true,
      },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }],
    });

    return aptos;
  }

  async updateApartamentoRecorrencia(idCondominio: number, aptoId: number, ignorar: boolean, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: false };

    // Certifica que o apartamento pertence ao condomínio
    const apto = await this.prisma.apartamentos.findFirst({
      where: {
        id: Number(aptoId),
        id_condominio: Number(idCondominio),
      },
    });

    if (!apto) {
      throw new NotFoundException('Apartamento não encontrado neste condomínio');
    }

    await this.prisma.apartamentos.update({
      where: { id: Number(aptoId) },
      data: { ignorar_recorrencia: ignorar },
    });

    return { success: true };
  }

  /**
   * Limpeza one-shot (síndico/admin): remove unidades fantasma ("Apto 000" /
   * bloco "Condominio") e cobranças pendentes de R$ 0,00 geradas pelo job de
   * recorrência antes da validação de valor existir. Idempotente — rodar de
   * novo num condomínio já limpo não tem efeito. Tudo auditado.
   *
   * Cobranças PAGAS não são tocadas (histórico contábil).
   */
  async adminLimparCobrancasZeradas(idCondominio: number, operatorName: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };
    await this.tenant.assertCondominio(idCondominio, user);

    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
    });
    const fantasmas = aptos.filter((a) => this.isUnidadeFantasma(a.apto, a.bloco));

    const pendentes = await this.prisma.financeiro.findMany({
      where: { id_condominio: Number(idCondominio), pago: 0, tipo: 'C' },
      select: { id: true, nome: true, valor: true },
    });
    const idsFantasma = pendentes
      .filter((f) => fantasmas.some((a) => this.nomeFaturaDeApto(f.nome, a.apto, a.bloco)))
      .map((f) => f.id);
    const idsZeradas = pendentes
      .filter((f) => !f.valor || Number(f.valor) <= 0)
      .map((f) => f.id);
    const idsRemover = Array.from(new Set([...idsFantasma, ...idsZeradas]));
    const idsAptosFantasma = fantasmas.map((a) => a.id);

    const [delFinanceiro, , delAptos] = await this.prisma.$transaction([
      this.prisma.financeiro.deleteMany({ where: { id: { in: idsRemover } } }),
      // Vínculos de usuários com a unidade fantasma (FK) antes do apartamento.
      this.prisma.apartamentos_Users.deleteMany({ where: { id_apto: { in: idsAptosFantasma } } }),
      this.prisma.apartamentos.deleteMany({ where: { id: { in: idsAptosFantasma } } }),
    ]);

    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'DELETE',
      modulo: 'financeiro',
      entidade_id: undefined,
      descricao: `Limpeza de dados: removeu ${delFinanceiro.count} cobrança(s) zerada(s)/fantasma e ${delAptos.count} unidade(s) inválida(s)`,
      detalhes: {
        unidadesRemovidas: fantasmas.map((a) => ({ id: a.id, apto: a.apto, bloco: a.bloco })),
        cobrancasZeradas: idsZeradas.length,
        cobrancasDeUnidadeFantasma: idsFantasma.length,
        idsRemovidos: idsRemover.slice(0, 100),
      },
    });

    this.logger.log(
      `[adminLimparCobrancasZeradas] Condomínio ${idCondominio}: ${delFinanceiro.count} cobranças e ${delAptos.count} unidades removidas.`,
    );

    return {
      success: true,
      cobrancasRemovidas: delFinanceiro.count,
      unidadesRemovidas: delAptos.count,
    };
  }

  /**
   * Por quantos dias após o `dia_geracao` o job ainda tenta emitir as faturas
   * do mês, caso o tick do dia certo tenha sido perdido.
   */
  private static readonly JANELA_RECUPERACAO_DIAS = 5;

  /** Último dia do mês (mes é 1-12). */
  private static ultimoDiaDoMes(mes: number, ano: number): number {
    return new Date(ano, mes, 0).getDate();
  }

  /**
   * Dia configurado, encolhido para caber no mês.
   *
   * `dia_geracao`/`dia_vencimento` = 31 não existe em abril, e 29/30 não
   * existem em fevereiro. Sem o clamp, o dia 31 simplesmente nunca chegava e
   * o `new Date(ano, mes-1, 31)` transbordava para o mês seguinte.
   */
  private static diaValidoNoMes(dia: number, mes: number, ano: number): number {
    const ultimo = FinanceiroService.ultimoDiaDoMes(mes, ano);
    return Math.min(Math.max(Number(dia) || 1, 1), ultimo);
  }

  async runRecurringBillingJob() {
    if (!this.prisma.isConnected) return;
    this.logger.log('Iniciando Job de Faturamento Recorrente...');

    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    // Busca todos os condomínios com recorrência ativa
    const condominios = await this.prisma.condominios.findMany({
      where: { recorrencia_ativa: true },
      select: {
        id: true,
        dia_geracao: true,
      },
    });

    for (const cond of condominios) {
      // `dia_geracao === diaAtual` era um fio de navalha: o job só tenta uma
      // vez por dia, na hora-gatilho. Se o tick daquela hora não acontecesse
      // — deploy no Railway reiniciando o processo, banco lento, qualquer
      // exceção antes daqui — o mês inteiro ficava SEM faturamento, em
      // silêncio, e só se descobria quando ninguém pagava. Com dia_geracao 31
      // então, o job nunca rodava em abril, junho, setembro e novembro.
      //
      // Agora há uma janela de recuperação: o job insiste por alguns dias
      // após o dia de geração. A criação é idempotente (pula fatura cujo nome
      // já existe), então as tentativas seguintes não fazem nada.
      //
      // A janela é fechada de propósito, em vez de ir até o fim do mês: se o
      // síndico apagar uma fatura recorrente (valor errado, unidade vendida),
      // ela não deve ressuscitar sozinha semanas depois.
      const diaGeracao = FinanceiroService.diaValidoNoMes(cond.dia_geracao, mesAtual, anoAtual);
      const atraso = diaAtual - diaGeracao;
      if (atraso >= 0 && atraso <= FinanceiroService.JANELA_RECUPERACAO_DIAS) {
        if (atraso > 0) {
          this.logger.warn(
            `[runRecurringBillingJob] Condomínio ${cond.id}: rodando ${atraso} dia(s) após o dia de geração ` +
            `(${diaGeracao}). Se gerar faturas agora, o tick do dia certo foi perdido.`,
          );
        }
        await this.gerarFaturasRecorrentesParaMes(cond.id, mesAtual, anoAtual, false);
      }
    }
  }

  async gerarFaturasRecorrentesParaMes(condId: number, mes: number, ano: number, force = false) {
    if (!this.prisma.isConnected) return;

    const cond = await this.prisma.condominios.findUnique({
      where: { id: condId },
    });

    if (!cond || !cond.recorrencia_ativa) return;

    // Recorrência ativa com valor zero é erro de configuração — sem esta
    // guarda o job gerava dezenas de faturas de R$ 0,00 por mês, poluindo
    // a inadimplência (aptos "devendo" R$ 0,00). O insert manual já valida
    // valor > 0; o job precisa da mesma regra.
    const valorTaxa = Number(cond.valor_condominio ?? 0);
    if (valorTaxa <= 0) {
      if (force) {
        throw new BadRequestException(
          'Defina o valor da taxa condominial (maior que zero) nas configurações de recorrência antes de gerar as faturas.',
        );
      }
      this.logger.warn(
        `[gerarFaturasRecorrentesParaMes] Condomínio ${cond.id} com recorrência ativa e valor_condominio <= 0 — geração pulada.`,
      );
      return;
    }

    const refStr = `${String(mes).padStart(2, '0')}/${ano}`;

    // Valida se já chegou no mês/ano de início da recorrência (se configurado)
    if (!force) {
      if (cond.ano_inicio_recorrencia !== null && cond.ano_inicio_recorrencia !== undefined) {
        if (ano < cond.ano_inicio_recorrencia) {
          return;
        }
        if (ano === cond.ano_inicio_recorrencia && cond.mes_inicio_recorrencia !== null && cond.mes_inicio_recorrencia !== undefined) {
          if (mes < cond.mes_inicio_recorrencia) {
            return;
          }
        }
      }
    }

    // Calcula data de vencimento da fatura
    let vencMonth = mes;
    let vencYear = ano;
    if (cond.dia_vencimento < cond.dia_geracao) {
      vencMonth += 1;
      if (vencMonth > 12) {
        vencMonth = 1;
        vencYear += 1;
      }
    }
    // Dia encolhido para o mês: com dia_vencimento 31, `new Date(2026, 8, 31)`
    // virava 1º de outubro — a fatura de setembro nascia vencendo em outubro,
    // e por isso aparecia na competência errada na tela de taxas dos moradores
    // (que casa pela data). Mesmo problema com 30 em fevereiro.
    const diaVenc = FinanceiroService.diaValidoNoMes(cond.dia_vencimento, vencMonth, vencYear);
    const dataVencimento = new Date(vencYear, vencMonth - 1, diaVenc, 12, 0, 0, 0);
    const hoje = new Date();

    // Busca todos os apartamentos do condomínio que NÃO ignoram a recorrência
    const aptos = await this.prisma.apartamentos.findMany({
      where: { 
        id_condominio: cond.id,
        ignorar_recorrencia: false,
      },
    });

    this.logger.log(`[gerarFaturasRecorrentesParaMes] Gerando faturas recorrentes para o condomínio ${cond.nome} (${aptos.length} apartamentos) ref ${refStr}...`);

    for (const apto of aptos) {
      // Defesa em profundidade: unidades fantasma (ex.: "Apto 000 Bloco
      // Condominio") não recebem cobrança — o cadastro também passa a
      // rejeitá-las, mas registros antigos podem ainda existir no banco.
      if (this.isUnidadeFantasma(apto.apto, apto.bloco)) {
        this.logger.warn(
          `[gerarFaturasRecorrentesParaMes] Pulando unidade inválida Apto ${apto.apto} Bloco ${apto.bloco} (id ${apto.id})`,
        );
        continue;
      }

      const faturaNome = `Apto ${apto.apto} Bloco ${apto.bloco} - ${cond.categoria_padrao} Ref. ${refStr}`;

      // Evita gerar faturas duplicadas.
      //
      // A checagem era por nome EXATO — e o nome carrega `categoria_padrao`.
      // Como salvar a tela de cobrança automática dispara uma geração forçada,
      // mudar a categoria (de "Taxa Condominial" para "Condomínio", por
      // exemplo) e salvar fazia o nome não bater com o das faturas já geradas:
      // o mês inteiro era emitido DE NOVO, e todo apartamento passava a dever
      // duas taxas do mesmo mês. A janela de recuperação do job repetia o
      // mesmo estrago nos dias seguintes.
      //
      // A identidade de uma fatura recorrente é "esta unidade, esta
      // competência" — a categoria é rótulo, não chave. Casa por prefixo da
      // unidade + sufixo da referência, então renomear a categoria não
      // ressuscita a cobrança. Rateio e acordo têm outro formato de nome
      // ("- Rateio:", "- Acordo Parc.") e não são afetados.
      const existe = await this.prisma.financeiro.findFirst({
        where: {
          id_condominio: cond.id,
          nome: {
            startsWith: `Apto ${apto.apto} Bloco ${apto.bloco} - `,
            endsWith: `Ref. ${refStr}`,
          },
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
          valor: valorTaxa,
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
          criado.data_vencimento,
        );
        if (pixData?.brCode) {
          criado = await this.prisma.financeiro.update({
            where: { id: criado.id },
            data: { pix_copia_cola: pixData.brCode },
          });
        }
      } catch (pixErr) {
        this.logger.error(`[gerarFaturasRecorrentesParaMes] Erro OpenPix para fatura ${criado.id}: ${pixErr}`);
      }

      // Notifica moradores do apartamento (relacional e legado)
      const moradores = await this.prisma.users.findMany({
        where: {
          OR: [
            {
              apartamentosUsers: {
                some: { id_apto: apto.id },
              },
            },
            {
              moradores: {
                some: { id_condominio: cond.id, apartamento: apto.apto, bloco: apto.bloco },
              },
            },
          ],
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
            this.logger.error(`[gerarFaturasRecorrentesParaMes] Erro WhatsApp para ${morador.name}: ${whatsErr}`);
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
          // Não cobrar por WhatsApp uma dívida que o próprio síndico já
          // renegociou — o morador recebia a régua de cobrança do débito
          // antigo no mesmo dia em que assinava o acordo.
          ...FinanceiroService.NAO_RENEGOCIADO,
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
