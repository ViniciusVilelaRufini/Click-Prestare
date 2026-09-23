import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pessoasMigrationEnabled } from '../common/pessoas-migration.util';

const AdmZip = require('adm-zip');

export interface SolicitanteExportacao {
  nome?: string;
  email?: string;
  ip?: string;
}

@Injectable()
export class CondominiosExportService {
  constructor(private readonly prisma: PrismaService) {}

  async gerarPacoteExportacao(
    idCondominio: number,
    solicitante?: SolicitanteExportacao,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const zip = new AdmZip();

    // 1. Unidades e Moradores
    const csvMoradores = await this.gerarCsvMoradores(idCondominio);
    zip.addFile('unidades_e_moradores.csv', Buffer.from(csvMoradores, 'utf8'));

    // 2. Veículos e Vagas
    const csvVeiculos = await this.gerarCsvVeiculos(idCondominio);
    zip.addFile('veiculos_e_vagas.csv', Buffer.from(csvVeiculos, 'utf8'));

    // 3. Visitantes e Prestadores
    const csvVisitantes = await this.gerarCsvVisitantesEPrestadores(idCondominio);
    zip.addFile('visitantes_e_prestadores.csv', Buffer.from(csvVisitantes, 'utf8'));

    // 4. Encomendas
    const csvEncomendas = await this.gerarCsvEncomendas(idCondominio);
    zip.addFile('encomendas.csv', Buffer.from(csvEncomendas, 'utf8'));

    // 5. Ocorrências
    const csvOcorrencias = await this.gerarCsvOcorrencias(idCondominio);
    zip.addFile('ocorrencias.csv', Buffer.from(csvOcorrencias, 'utf8'));

    // 6. Registros de Acessos
    const csvAcessos = await this.gerarCsvRegistrosAcessos(idCondominio);
    zip.addFile('registros_acessos.csv', Buffer.from(csvAcessos, 'utf8'));

    // Auditoria
    try {
      if (this.prisma?.auditLog?.create) {
        await this.prisma.auditLog.create({
          data: {
            id_condominio: idCondominio,
            usuario_nome: solicitante?.nome || 'Síndico',
            usuario_email: solicitante?.email ?? null,
            acao: 'EXPORT',
            modulo: 'condominios',
            descricao: 'Exportação completa de dados do condomínio gerada pelo síndico (LGPD)',
            ip: solicitante?.ip ?? null,
          },
        });
      }
    } catch (e) {
      console.error('[CondominiosExportService] Falha ao registrar log de auditoria:', e);
    }

    const stamp = this.getTimestamp();
    const filename = `export_condominio_${idCondominio}_${stamp}.zip`;
    const buffer = zip.toBuffer();

    return { buffer, filename };
  }

  private async gerarCsvMoradores(idCondominio: number): Promise<string> {
    const moradores = await this.prisma.moradores.findMany({
      where: { id_condominio: idCondominio },
      include: { user: true },
      orderBy: [
        { bloco: 'asc' },
        { apartamento: 'asc' },
        { nome: 'asc' },
      ],
    });

    const header = [
      'Bloco',
      'Unidade',
      'Nome',
      'Tipo',
      'E-mail',
      'Telefone',
      'Documento',
      'Data de Nascimento',
    ];

    const rows = moradores.map((m) => [
      m.bloco ?? '',
      m.apartamento ?? '',
      m.nome ?? '',
      m.tipo ?? (m.user?.is_morador ? 'Morador' : 'Dependente'),
      m.email ?? m.user?.email ?? '',
      m.telefone ?? '',
      m.documento ?? '',
      m.data_nascimento ? m.data_nascimento.toISOString().slice(0, 10) : '',
    ]);

    return this.formatCsv(header, rows);
  }

  private async gerarCsvVeiculos(idCondominio: number): Promise<string> {
    const veiculos = await this.prisma.veiculos.findMany({
      where: { id_condominio: idCondominio },
      include: {
        morador: true,
        vagas: true,
      },
      orderBy: { placa: 'asc' },
    });

    const header = ['Placa', 'Modelo', 'Cor', 'Bloco', 'Unidade', 'Vaga', 'Morador'];

    const rows = veiculos.map((v) => [
      v.placa ?? '',
      v.marca_modelo ?? '',
      v.cor ?? '',
      v.morador?.bloco ?? '',
      v.morador?.apartamento ?? '',
      v.vagas && v.vagas.length > 0 ? v.vagas.map((vg: any) => vg.id).join(';') : '',
      v.morador?.nome ?? '',
    ]);

    return this.formatCsv(header, rows);
  }

  private async gerarCsvVisitantesEPrestadores(idCondominio: number): Promise<string> {
    const visitantesRaw = pessoasMigrationEnabled(this.prisma)
      ? await this.prisma.visitas.findMany({
          where: { id_condominio: idCondominio },
          include: { pessoa: true, apartamento: true },
          orderBy: { created_at: 'desc' },
        })
      : await this.prisma.visitantes.findMany({
          where: { id_condominio: idCondominio },
          include: { apartamento: true },
          orderBy: { created_at: 'desc' },
        });

    // No caminho migrado, achata `pessoa` de volta pro formato que o resto
    // deste método (nome/doc_identificacao na raiz) já espera — mesma
    // convenção usada nas outras leituras migradas desta rodada.
    const visitantes = visitantesRaw.map((v: any) =>
      v.pessoa
        ? { ...v, nome: v.pessoa.nome, doc_identificacao: v.pessoa.doc_identificacao }
        : v,
    );

    const prestadores = await this.prisma.prestadores_servico.findMany({
      where: { id_condominio: idCondominio },
      include: { apartamento: true },
      orderBy: { created_at: 'desc' },
    });

    const header = [
      'Nome',
      'Documento',
      'Tipo',
      'Unidade Destino',
      'Data/Hora Entrada',
      'Data/Hora Saída',
      'Situação',
    ];

    const rows: string[][] = [];

    for (const v of visitantes) {
      const unidade = v.apartamento
        ? `${v.apartamento.apto || ''}${v.apartamento.bloco ? ' ' + v.apartamento.bloco : ''}`
        : '';
      const situacao = v.bloqueado ? 'Bloqueado' : v.liberado ? 'Liberado' : 'Pendente';

      rows.push([
        v.nome ?? '',
        v.doc_identificacao ?? '',
        v.is_prestador ? 'Prestador' : 'Visitante',
        unidade,
        v.data_entrada ? v.data_entrada.toISOString() : '',
        v.data_saida ? v.data_saida.toISOString() : '',
        situacao,
      ]);
    }

    for (const p of prestadores) {
      const unidade = p.apartamento
        ? `${p.apartamento.apto || ''}${p.apartamento.bloco ? ' ' + p.apartamento.bloco : ''}`
        : 'Condomínio';

      rows.push([
        p.nome ?? '',
        '',
        'Prestador de Serviço',
        unidade,
        '',
        '',
        'Cadastrado',
      ]);
    }

    return this.formatCsv(header, rows);
  }

  private async gerarCsvEncomendas(idCondominio: number): Promise<string> {
    const encomendas = await this.prisma.encomendas.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { recebido_em: 'desc' },
    });

    const header = [
      'Código/Rastreio',
      'Destinatário Bloco',
      'Destinatário Unidade',
      'Descrição',
      'Data Chegada',
      'Data Retirada',
      'Quem Retirou',
      'Status',
    ];

    const rows = encomendas.map((e) => [
      e.codigo_rastreio || e.codigo_validacao || '',
      e.destinatario_bloco ?? '',
      e.destinatario_apto ?? '',
      e.descricao ?? '',
      e.recebido_em ? e.recebido_em.toISOString() : '',
      e.retirado_em ? e.retirado_em.toISOString() : '',
      e.retirado_por ?? '',
      e.status ?? '',
    ]);

    return this.formatCsv(header, rows);
  }

  private async gerarCsvOcorrencias(idCondominio: number): Promise<string> {
    const ocorrencias = await this.prisma.ocorrencias.findMany({
      where: { id_condominio: idCondominio },
      include: {
        categoria: true,
        criadoPor: {
          include: { moradores: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const header = [
      'Título/ID',
      'Categoria',
      'Data de Abertura',
      'Unidade',
      'Status',
      'Descrição',
      'Resposta',
    ];

    const rows = ocorrencias.map((o) => {
      const morador = o.criadoPor?.moradores?.[0];
      const unidade = morador
        ? `${morador.apartamento || ''}${morador.bloco ? ' ' + morador.bloco : ''}`
        : '';

      return [
        String(o.id),
        o.categoria?.nome ?? 'Geral',
        o.created_at ? o.created_at.toISOString() : '',
        unidade,
        o.status ?? '',
        o.descricao ?? '',
        o.resposta ?? '',
      ];
    });

    return this.formatCsv(header, rows);
  }

  private async gerarCsvRegistrosAcessos(idCondominio: number): Promise<string> {
    const acessos = await this.prisma.acessos_Facial.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { timestamp: 'desc' },
      take: 10_000,
    });

    const header = [
      'Data/Hora',
      'Pessoa',
      'Tipo Pessoa',
      'Ponto de Acesso',
      'Evento',
      'Confiança (%)',
    ];

    const rows = acessos.map((a) => [
      a.timestamp ? a.timestamp.toISOString() : '',
      a.nome_pessoa ?? '',
      a.tipo_pessoa ?? '',
      String(a.id_device),
      a.evento ?? '',
      a.confianca != null ? String(a.confianca) : '',
    ]);

    return this.formatCsv(header, rows);
  }

  private formatCsv(header: string[], rows: string[][]): string {
    const lines = [header.map(this.csvEscape).join(',')];
    for (const row of rows) {
      lines.push(row.map(this.csvEscape).join(','));
    }
    // Prefixo BOM (\uFEFF) para garantir abertura correta em UTF-8 no Excel
    return '\uFEFF' + lines.join('\n');
  }

  private csvEscape(value: any): string {
    if (value == null) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  private getTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
}
