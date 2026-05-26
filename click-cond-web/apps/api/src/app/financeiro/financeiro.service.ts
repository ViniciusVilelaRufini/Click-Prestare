import { Injectable, NotFoundException, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MailService } from '../common/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FinanceiroService implements OnModuleInit {
  private readonly logger = new Logger(FinanceiroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Inicializa o job de cobrança automática 30 segundos após o startup, rodando a cada 24 horas.
    setTimeout(() => this.runBillingRemindersJob(), 30000);
    setInterval(() => this.runBillingRemindersJob(), 24 * 60 * 60 * 1000);
  }

  // ==========================================
  // CRUD PRINCIPAL
  // ==========================================
  async insert(idCondominio: number, financeiro: any, operatorName: string) {
    if (!this.prisma.isConnected) return { success: true };

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

    await this.prisma.financeiro.create({
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

    return { success: true };
  }

  async update(idCondominio: number, financeiro: any, operatorName: string) {
    if (!this.prisma.isConnected) return { success: true };

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

    return { success: true };
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    await this.prisma.financeiro.delete({ where: { id: Number(id) } });
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

    const result = await this.prisma.financeiro.findFirst({
      where: { id: Number(id), id_condominio: Number(idCondominio) },
    });

    if (!result) throw new NotFoundException('Lançamento não encontrado.');

    const isMorador = user?.typeAccess === 'Morador';
    if (isMorador && result.nome && !result.nome.includes('Apto')) {
      // Logic for isolation (dummy for now since id_usuario is missing)
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
  async getAll(idCondominio: number, mesStr?: string, anoStr?: string, isSindico: boolean = true) {
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
  async getAllMoradores(idCondominio: number, mesStr: string, anoStr: string) {
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

  async getAllInadimplentes(idCondominio: number) {
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

    const blocosMap: Record<string, any[]> = {};

    for (const a of aptos) {
      // Checar em quantos dos meses faturados este apartamento possui `pago = 1`
      let pagosCount = 0;
      for (const m of meses) {
        const matchName = `Apto ${a.apto} Bloco ${a.bloco} - Ref. ${m.mes}/${m.ano}`;
        const fin = await this.prisma.financeiro.findFirst({
          where: {
            id_condominio: Number(idCondominio),
            nome: matchName,
            pago: 1,
          },
        });
        if (fin) pagosCount++;
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

  async getInadimplenteDetail(idCondominio: number, apto: string, bloco: string) {
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

  async notifyInadimplente(idCondominio: number, apto: string, bloco: string) {
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
  async getGrafico(idCondominio: number, mesStr: string, anoStr: string) {
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

    // Filtra as cobranças: despesas gerais (D) são públicas para transparência,
    // cobranças (C) só aparecem se forem destinadas ao bloco e apartamento do morador.
    // As contas privadas do próprio morador (id_usuario == idUser) sempre passam.
    const filteredList = list.filter(item => {
      if (item.id_usuario === idUser) return true;
      if (item.tipo === 'C') {
        return moradoresList.some(m => 
          item.nome?.includes(`Apto ${m.apartamento}`) && 
          item.nome?.includes(`Bloco ${m.bloco}`)
        );
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

  async uploadSharedFile(id: number, fileBase64: string, type: string) {
    if (!this.prisma.isConnected) return { url: '' };

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

  async updateStatus(id: number, statusStr: string | number) {
    if (!this.prisma.isConnected) return { success: true };

    const status = String(statusStr);
    const isPago = status === '1' ? 1 : 0;

    await this.prisma.financeiro.update({
      where: { id: Number(id) },
      data: { status, pago: isPago },
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
    this.logger.log(`Webhook recebido: ${JSON.stringify(body)}`);

    if (body.event === 'PAYMENT_RECEIVED' || body.event === 'PAYMENT_CONFIRMED') {
      const financeiroId = Number(body.payment.externalReference);
      if (financeiroId) {
        await this.prisma.financeiro.update({
          where: { id: financeiroId },
          data: {
            status: '1', // Pago
            pago: 1,
            data: new Date(),
          },
        });
        this.logger.log(`Pagamento confirmado via Webhook para Lançamento ID: ${financeiroId}`);
      }
    }
    return { success: true };
  }

  async registerRecurringCard(idUser: number, cardData: any) {
    this.logger.log(`Registrando recorrência de cartão para Usuário ID ${idUser}`);
    return { success: true, message: 'Cartão de crédito registrado para recorrência mensal com sucesso!' };
  }

  async createRateio(idCondominio: number, rateioData: { nome: string; valorTotal: number; data_vencimento: string; categoria: string }, operatorName: string) {
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

    const createdCharges = [];
    for (const apto of aptos) {
      const charge = await this.prisma.financeiro.create({
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
      });
      createdCharges.push(charge);
    }

    return { success: true, count: createdCharges.length, message: `Cobrança rateada criada para ${createdCharges.length} apartamentos.` };
  }

  async createAcordoInadimplente(idCondominio: number, acordoData: { apto: string; bloco: string; parcelas: number; valorTotal: number }, operatorName: string) {
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

    for (const deb of debitos) {
      await this.prisma.financeiro.update({
        where: { id: deb.id },
        data: {
          status: '3', // Renegociado
          descricao: `Renegociado no acordo em lote pelo síndico.`,
        },
      });
    }

    const valorParcela = Number(acordoData.valorTotal) / Number(acordoData.parcelas);
    const hoje = new Date();

    for (let i = 1; i <= acordoData.parcelas; i++) {
      const vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + i, 10);
      await this.prisma.financeiro.create({
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
      });
    }

    return { success: true, message: `Acordo firmado com sucesso em ${acordoData.parcelas} parcelas de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` };
  }

  async runBillingRemindersJob() {
    if (!this.prisma.isConnected) return;
    this.logger.log('Iniciando Job de Lembretes de Cobrança...');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const faturas = await this.prisma.financeiro.findMany({
      where: {
        pago: 0,
        data_vencimento: { not: null },
      },
    });

    for (const fat of faturas) {
      if (!fat.data_vencimento) continue;
      
      const venc = new Date(fat.data_vencimento);
      venc.setHours(0, 0, 0, 0);
      
      const diffTime = venc.getTime() - hoje.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 5 || diffDays === 0 || diffDays === -1) {
        const aptoMatch = fat.nome?.match(/Apto\s+(\S+)\s+Bloco\s+(\S+)/i);
        if (!aptoMatch) continue;

        const apto = aptoMatch[1];
        const bloco = aptoMatch[2];

        const moradores = await this.prisma.users.findMany({
          where: {
            moradores: {
              some: {
                id_condominio: fat.id_condominio,
                apartamento: apto,
                bloco: bloco,
              },
            },
          },
        });

        let title = '';
        let body = '';

        if (diffDays === 5) {
          title = 'Lembrete de Vencimento';
          body = `Olá! A fatura (${fat.nome}) no valor de R$ ${fat.valor} vence em 5 dias (${venc.toLocaleDateString('pt-BR')}).`;
        } else if (diffDays === 0) {
          title = 'Fatura Vence Hoje!';
          body = `Atenção: A fatura (${fat.nome}) no valor de R$ ${fat.valor} vence hoje! Evite multas e juros.`;
        } else if (diffDays === -1) {
          title = 'Fatura Vencida!';
          body = `Constatamos que a fatura (${fat.nome}) no valor de R$ ${fat.valor} venceu ontem. Regularize seu débito.`;
        }

        for (const morador of moradores) {
          if (morador.fcm_token) {
            await this.notifications.sendPushNotification(
              morador.fcm_token,
              title,
              body,
              { id: fat.id.toString(), type: 'financeiro' },
            );
          }
          if (morador.email) {
            try {
              await this.mail.sendBillingReminder(
                morador.email,
                morador.name || 'Morador',
                fat.nome || 'Taxa Condominial',
                venc.toLocaleDateString('pt-BR'),
                Number(fat.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                fat.pix_copia_cola || undefined,
              );
            } catch (err) {
              this.logger.error(`Erro ao enviar email para ${morador.email}: ${err}`);
            }
          }
        }
      }
    }
    this.logger.log('Job de Lembretes de Cobrança concluído.');
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

  async parseOfxContent(idCondominio: number, ofxContent: string) {
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

  async confirmarConciliacao(idCondominio: number, reconciliations: { databaseId: number; dataPagamento: string }[]) {
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
    }
    return { success: true };
  }
}
