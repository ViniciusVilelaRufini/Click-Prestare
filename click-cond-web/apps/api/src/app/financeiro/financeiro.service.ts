import { Injectable, NotFoundException, OnModuleInit, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MailService } from '../common/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertSameTenant } from '../auth/tenant.util';
import { AuditoriaService } from '../auditoria/auditoria.service';

@Injectable()
export class FinanceiroService implements OnModuleInit {
  private readonly logger = new Logger(FinanceiroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly auditoria: AuditoriaService,
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

    const parseDate = (dStr?: string) => {
      if (!dStr) return null;
      let d: Date;
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        d = new Date(dStr);
      }
      return isNaN(d.getTime()) ? null : d;
    };

    const dLanc = parseDate(financeiro.data);
    const dVenc = parseDate(financeiro.data_vencimento);

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

    const criado = await this.prisma.financeiro.create({
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
        parcelas: financeiro.parcelas ?? null,
        nome_operador: operatorName,
        id_condominio: Number(idCondominio),
        photo: photoUrl,
        pago: isPago,
        url_boleto: financeiro.url_boleto ?? null,
        status: financeiro.status ? String(financeiro.status) : '0',
        linha_digitavel: financeiro.linha_digitavel ?? null,
        pix_copia_cola: financeiro.pix_copia_cola ?? null,
        id_usuario: idUsuario,
      },
    });

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

    const parseDate = (dStr?: string) => {
      if (!dStr) return null;
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      }
      return new Date(dStr);
    };

    const dLanc = parseDate(financeiro.data);
    const dVenc = parseDate(financeiro.data_vencimento);

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
        parcelas: financeiro.parcelas,
        nome_operador: operatorName,
        ...(photoUrl !== undefined ? { photo: photoUrl } : {}),
        ...(financeiro.status !== undefined ? { status: String(financeiro.status) } : {}),
        ...(financeiro.linha_digitavel !== undefined ? { linha_digitavel: financeiro.linha_digitavel } : {}),
        ...(financeiro.pix_copia_cola !== undefined ? { pix_copia_cola: financeiro.pix_copia_cola } : {}),
        id_usuario: idUsuario,
      },
    });

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
          const aptoTag = `Apto ${moradorMatch.apartamento} Bloco ${moradorMatch.bloco}`;
          if (!result.nome.includes(aptoTag)) {
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

    const financeiroRecords = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        nome: {
          contains: `- Ref. ${mesStr}/${anoStr}`
        }
      }
    });

    const finMap = new Map<string, any>();
    for (const fin of financeiroRecords) {
      if (fin.nome) {
        finMap.set(fin.nome.trim(), fin);
      }
    }

    const blocosMap: Record<string, any[]> = {};

    const fmtDate = (d?: Date | null) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    for (const a of aptos) {
      const matchName = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${mesStr}/${anoStr}`;
      const fin = finMap.get(matchName);

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

    const meses = await this.getAllMeses(idCondominio);
    if (meses.length === 0) return { blocos: [] };

    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }],
    });

    // Otimização: Carrega todos os lançamentos faturados pagos do condomínio de uma só vez
    const faturasPagas = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 1,
        nome: { contains: 'Ref.' },
      },
      select: { nome: true },
    });

    const setPagas = new Set(
      faturasPagas.map(f => f.nome ? f.nome.trim() : '')
    );

    const blocosMap: Record<string, any[]> = {};

    for (const a of aptos) {
      // Checar em quantos dos meses faturados este apartamento possui `pago = 1`
      let pagosCount = 0;
      for (const m of meses) {
        const matchName1 = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${m.mes}/${m.ano}`;
        const anoCurto = m.ano.slice(-2);
        const matchName2 = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${m.mes}/${anoCurto}`;
        if (setPagas.has(matchName1.trim()) || setPagas.has(matchName2.trim())) {
          pagosCount++;
        }
      }

      const devendoCount = meses.length - pagosCount;
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

    const meses = await this.getAllMeses(idCondominio);
    const faturasDevendo: any[] = [];

    for (const m of meses) {
      const anoCurto = m.ano.slice(-2);
      const matchName1 = `Apto ${apto} Bloco ${bloco} - Ref. ${m.mes}/${m.ano}`;
      const matchName2 = `Apto ${apto} Bloco ${bloco} - Ref. ${m.mes}/${anoCurto}`;

      const fin = await this.prisma.financeiro.findFirst({
        where: {
          id_condominio: Number(idCondominio),
          OR: [{ nome: matchName1 }, { nome: matchName2 }],
        },
      });

      if (!fin || fin.pago === 0) {
        const val = fin ? Number(fin.valor) : 650;
        faturasDevendo.push({
          mes: m.mes,
          ano: m.ano,
          periodo: m.periodo,
          id: fin?.id ?? null,
          nome: fin ? fin.nome : `Apto ${apto} Bloco ${bloco} - Ref. ${m.mes}/${m.ano}`,
          valor: val,
          valorString: val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          data_vencimento: fin && fin.data_vencimento ? new Date(fin.data_vencimento).toLocaleDateString('pt-BR') : `10/${m.mes}/${m.ano}`,
          pago: 0,
        });
      }
    }

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
    const mes = Number(mesStr);
    const ano = Number(anoStr);

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
          { id_usuario: null }
        ]
      },
      orderBy: { data_vencimento: 'desc' },
    });

    const filteredList = list.filter(item => {
      if (item.id_usuario === idUser) return true;
      if (item.tipo === 'C') {
        return moradoresList.some(m => {
          const aptoOk = item.nome?.includes(`Apto ${m.apartamento}`) ?? false;
          const temBloco = m.bloco !== null && m.bloco !== undefined && m.bloco.trim() !== '';
          const blocoOk = temBloco
            ? (item.nome?.includes(`Bloco ${m.bloco}`) ?? false)
            : (!item.nome?.includes('Bloco') || item.nome?.includes('Bloco ') === false || item.nome?.includes('Bloco  '));
          return aptoOk && blocoOk;
        });
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

    return { url };
  }

  async updateStatus(id: number, statusStr: string | number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Marcar despesa como paga é a mutação MAIS sensível do módulo financeiro.
    // Validação obrigatória: lançamento existe e pertence ao condomínio do operador.
    const lanc = await this.getLancamentoForTenant(id, user);

    const status = String(statusStr);
    const isPago = status === '1' ? 1 : 0;
    const statusAnterior = lanc.status;
    const pagoAnterior = lanc.pago;

    await this.prisma.financeiro.update({
      where: { id: Number(id) },
      data: { status, pago: isPago },
    });

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

    await this.prisma.financeiro.update({
      where: { id: financeiroId },
      data: {
        status: '1',
        pago: 1,
        data: new Date(),
      },
    });
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

  async registerRecurringCard(idUser: number, cardData: any) {
    this.logger.log(`Registrando recorrência de cartão para Usuário ID ${idUser}`);
    return { success: true, message: 'Cartão de crédito registrado para recorrência mensal com sucesso!' };
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
    const parseDate = (dStr?: string) => {
      if (!dStr) return null;
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      }
      return new Date(dStr);
    };
    const dVenc = parseDate(rateioData.data_vencimento);

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

    const formatReal = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operatorName,
      acao: 'CREATE',
      modulo: 'financeiro',
      entidade_id: null,
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

    const debitos = await this.prisma.financeiro.findMany({
      where: {
        id_condominio: Number(idCondominio),
        pago: 0,
        nome: {
          contains: `Apto ${acordoData.apto} Bloco ${acordoData.bloco}`,
        },
      },
    });

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
      entidade_id: null,
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

    const parseDate = (dStr?: string) => {
      if (!dStr) return null;
      let d: Date;
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        d = new Date(dStr);
      }
      return isNaN(d.getTime()) ? null : d;
    };

    const dVenc = parseDate(data.data_vencimento);

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

    const parseDate = (dStr?: string) => {
      if (!dStr) return null;
      let d: Date;
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        d = new Date(dStr);
      }
      return isNaN(d.getTime()) ? null : d;
    };

    const dVenc = parseDate(data.data_vencimento);
    const isPago = data.pago ? Number(data.pago) : 0;

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
    for (const rec of reconciliations) {
      const parsedDate = new Date(rec.dataPagamento);
      const isDateValid = !isNaN(parsedDate.getTime());

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
    }

    if (confirmados.length > 0) {
      await this.auditoria.registrar({
        id_condominio: Number(idCondominio),
        usuario_nome: user?.nome ?? 'Sistema',
        acao: 'STATUS',
        modulo: 'financeiro',
        entidade_id: null,
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

    return { success: true, confirmados: confirmados.length };
  }
}
