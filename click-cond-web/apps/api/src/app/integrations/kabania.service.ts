import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

const TECH_KEYWORDS = [
  'app', 'aplicativo', 'facial', 'face', 'reconhecimento',
  'sistema', 'software', 'bug', 'erro', 'falha', 'instabilidade',
  'entrar', 'acesso', 'bloqueado', 'bloqueada', 'nao consegue',
  'nao esta conseguindo', 'liberar', 'liberacao', 'visitante',
  'morador', 'botoeira', 'portao', 'abrir', 'abre', 'travado',
  'travada', 'controle de acesso', 'rfid', 'tag', 'chaveiro',
  'biometria', 'leitor', 'leitora', 'interfone', 'tecnico', 'tecnica',
  'camera'
];

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

@Injectable()
export class KabaniaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmService: CrmService
  ) {}

  async getSyncData() {
    // Modo Mock caso o banco de dados esteja offline
    if (!this.prisma.isConnected) {
      return {
        condominios: [
          {
            id: 1,
            nome: 'Condomínio Residencial Vista Alegre (Mock)',
            identificacao: 'CNPJ 12.345.678/0001-90',
            ativo: 1,
            created_at: new Date(),
          },
          {
            id: 2,
            nome: 'Edifício Costa Verde (Mock)',
            identificacao: 'CNPJ 98.765.432/0001-10',
            ativo: 1,
            created_at: new Date(),
          },
        ],
        ocorrencias: [
          {
            id: 1,
            descricao: 'Faturamento atrasado há 4 dia(s)',
            status: 'Pendente',
            created_at: new Date(),
            condominio_id: 1,
            condominio_nome: 'Condomínio Residencial Vista Alegre (Mock)',
            categoria: 'ATRASO',
            severidade: 'alta'
          },
          {
            id: 2,
            descricao: '2 terminal(is) facial(is) offline',
            status: 'Pendente',
            created_at: new Date(),
            condominio_id: 2,
            condominio_nome: 'Edifício Costa Verde (Mock)',
            categoria: 'OFFLINE',
            severidade: 'alta'
          },
        ].filter((o) => {
          const desc = normalizeText(o.descricao || '');
          const cat = normalizeText(o.categoria || '');
          return TECH_KEYWORDS.some((k) => desc.includes(k) || cat.includes(k));
        }),
        funcionarios: [
          {
            id: 'func-1',
            tipo: 'Administrativo/Operacional',
            nome: 'Carlos Souza (Mock)',
            funcao: 'Zelador',
            escala: '44h semanais',
            condominio_id: 1,
            condominio_nome: 'Condomínio Residencial Vista Alegre (Mock)',
            ativo: 1,
          },
          {
            id: 'port-1',
            tipo: 'Portaria',
            nome: 'Marcos Silva (Mock)',
            funcao: 'Porteiro',
            escala: 'Diurno (12x36)',
            condominio_id: 1,
            condominio_nome: 'Condomínio Residencial Vista Alegre (Mock)',
            ativo: 1,
          },
        ],
      };
    }

    // --- Busca de dados reais do banco usando Prisma ---
    
    // 1. Condomínios (Clientes)
    const rawClientes = await this.crmService.clientes();
    const condominios = rawClientes.map((c) => ({
      id: c.id,
      nome: c.nome,
      identificacao: c.identificacao,
      ativo: c.ativo ? 1 : 0,
      created_at: c.clienteDesde || new Date().toISOString(),
      cidade: c.cidade,
      uf: c.uf,
      email: c.contatoPrincipal?.email || '',
      phone: c.contatoPrincipal?.telefone || '',
      sindico_nome: c.contatoPrincipal?.nome || '',
      estagio: c.estagio,
      plano: c.plano,
      mrr: c.mrr,
    }));


    // 2. Pendências Operacionais/Financeiras do CRM (Alertas)
    // Coletamos a visão geral de alertas calculada pelo CrmService
    const crmOverview = await this.crmService.overview();
    
    const alertasFormatados = (crmOverview.alertas || []).map((alerta, idx) => ({
      id: alerta.id * 1000 + idx, // Gera um ID único para o card
      descricao: alerta.mensagem, // A mensagem explicativa do problema
      status: 'Pendente',
      created_at: new Date(),
      condominio_id: alerta.id,
      condominio_nome: alerta.nome,
      categoria: alerta.tipo.toUpperCase(), // Ex: 'ATRASO', 'VENCIMENTO', 'OFFLINE', 'HEALTH', 'INATIVIDADE'
      severidade: alerta.severidade, // 'alta', 'media', 'baixa'
    }));

    // Buscar ocorrências reais pendentes no banco
    const ocorrenciasBanco = await this.prisma.ocorrencias.findMany({
      where: { status: 'Pendente' },
      include: {
        condominio: { select: { nome: true } },
        categoria: { select: { nome: true } }
      }
    });

    const cardsOcorrenciasBanco = ocorrenciasBanco.map((o) => ({
      id: o.id + 100000, // Evita colisão de IDs com os alertas
      descricao: o.descricao || 'Chamado sem descrição',
      status: 'Pendente',
      created_at: o.created_at,
      condominio_id: o.id_condominio,
      condominio_nome: o.condominio?.nome || 'Desconhecido',
      categoria: o.categoria?.nome?.toUpperCase() || 'CHAMADO',
      severidade: 'media',
    }));

    const ocorrenciasFormatadas = [
      ...alertasFormatados,
      ...cardsOcorrenciasBanco
    ].filter((o) => {
      const desc = normalizeText(o.descricao || '');
      const cat = normalizeText(o.categoria || '');
      return TECH_KEYWORDS.some((k) => desc.includes(k) || cat.includes(k));
    });

    // 3. Funcionários e Portarias (Escalas)
    const funcionarios = await this.prisma.funcionarios.findMany({
      select: {
        id: true,
        nome: true,
        funcao: true,
        ch: true,
        id_condominio: true,
        condominio: {
          select: {
            nome: true,
          },
        },
      },
    });

    const porteiros = await this.prisma.funcionarios_Portaria.findMany({
      select: {
        id: true,
        nome: true,
        turno: true,
        ativo: true,
        id_condominio: true,
        condominio: {
          select: {
            nome: true,
          },
        },
      },
    });

    const funcionariosFormatados = [
      ...funcionarios.map((f) => ({
        id: `func-${f.id}`,
        tipo: 'Administrativo/Operacional',
        nome: f.nome,
        funcao: f.funcao || 'Funcionário',
        escala: f.ch || 'Não definida',
        condominio_id: f.id_condominio,
        condominio_nome: f.condominio?.nome || 'Desconhecido',
        ativo: 1,
      })),
      ...porteiros.map((p) => ({
        id: `port-${p.id}`,
        tipo: 'Portaria',
        nome: p.nome,
        funcao: 'Porteiro',
        escala: p.turno || 'Não definida',
        condominio_id: p.id_condominio,
        condominio_nome: p.condominio?.nome || 'Desconhecido',
        ativo: p.ativo,
      })),
    ];

    return {
      condominios,
      ocorrencias: ocorrenciasFormatadas,
      funcionarios: funcionariosFormatados,
    };
  }
}
