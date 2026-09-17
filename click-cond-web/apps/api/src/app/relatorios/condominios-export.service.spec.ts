import { CondominiosExportService } from './condominios-export.service';

const AdmZip = require('adm-zip');

describe('CondominiosExportService', () => {
  let service: CondominiosExportService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      condominios: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, nome: 'Residencial Teste' }),
      },
      moradores: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            nome: 'Carlos Morador',
            documento: '12345678900',
            email: 'carlos@teste.com',
            telefone: '11999998888',
            data_nascimento: new Date('1990-05-15'),
            bloco: 'A',
            apartamento: '101',
            tipo: 'Proprietário',
            user: { is_morador: 1, email: 'carlos@teste.com' },
          },
        ]),
      },
      veiculos: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 20,
            placa: 'ABC1D23',
            marca_modelo: 'Civic',
            cor: 'Preto',
            morador: { nome: 'Carlos Morador', bloco: 'A', apartamento: '101' },
            vagas: [{ id: 5 }],
          },
        ]),
      },
      visitantes: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 30,
            nome: 'Maria Visitante',
            doc_identificacao: '98765432100',
            is_prestador: 0,
            data_entrada: new Date('2026-09-01T10:00:00Z'),
            data_saida: new Date('2026-09-01T12:00:00Z'),
            liberado: 1,
            bloqueado: 0,
            apartamento: { apto: '101', bloco: 'A' },
          },
        ]),
      },
      prestadores_servico: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 40,
            nome: 'João Eletricista',
            telefone: '11988887777',
            apartamento: { apto: '101', bloco: 'A' },
          },
        ]),
      },
      encomendas: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 50,
            codigo_rastreio: 'BR123456789',
            destinatario_bloco: 'A',
            destinatario_apto: '101',
            descricao: 'Pacote Amazon',
            recebido_em: new Date('2026-09-02T14:00:00Z'),
            retirado_em: new Date('2026-09-02T18:00:00Z'),
            retirado_por: 'Carlos Morador',
            status: 'Entregue',
          },
        ]),
      },
      ocorrencias: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 60,
            descricao: 'Barulho após as 22h',
            status: 'Resolvida',
            resposta: 'Notificação enviada ao morador',
            created_at: new Date('2026-09-03T23:00:00Z'),
            categoria: { nome: 'Barulho' },
            criadoPor: { moradores: [{ apartamento: '101', bloco: 'A' }] },
          },
        ]),
      },
      acessos_Facial: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 70,
            timestamp: new Date('2026-09-04T08:30:00Z'),
            nome_pessoa: 'Carlos Morador',
            tipo_pessoa: 'morador',
            id_device: 2,
            evento: 'autorizado',
            confianca: 98.5,
          },
        ]),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 80 }),
      },
    };

    service = new CondominiosExportService(prismaMock);
  });

  it('deve gerar pacote .zip contendo os 6 arquivos CSV em UTF-8 com BOM', async () => {
    const { buffer, filename } = await service.gerarPacoteExportacao(1, {
      nome: 'Síndico Teste',
      email: 'sindico@condo.com',
    });

    expect(filename).toMatch(/^export_condominio_1_\d{8}_\d{6}\.zip$/);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    const entryNames = zipEntries.map((e) => e.entryName).sort();

    expect(entryNames).toEqual([
      'encomendas.csv',
      'ocorrencias.csv',
      'registros_acessos.csv',
      'unidades_e_moradores.csv',
      'veiculos_e_vagas.csv',
      'visitantes_e_prestadores.csv',
    ]);

    // Verificar se cada CSV inicia com BOM (\uFEFF) e contém os dados mockados
    for (const entry of zipEntries) {
      const content = entry.getData().toString('utf8');
      expect(content.startsWith('\uFEFF')).toBe(true);
    }

    // Verificar conteúdo de unidades_e_moradores.csv
    const moradoresCsv = zip.getEntry('unidades_e_moradores.csv')!.getData().toString('utf8');
    expect(moradoresCsv).toContain('Carlos Morador');
    expect(moradoresCsv).toContain('12345678900');
    expect(moradoresCsv).toContain('1990-05-15');

    // Verificar conteúdo de veiculos_e_vagas.csv
    const veiculosCsv = zip.getEntry('veiculos_e_vagas.csv')!.getData().toString('utf8');
    expect(veiculosCsv).toContain('ABC1D23');
    expect(veiculosCsv).toContain('Civic');

    // Verificar registro de auditoria
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id_condominio: 1,
          acao: 'EXPORT',
          modulo: 'condominios',
        }),
      }),
    );
  });

  it('deve isolar estritamente os dados pelo idCondominio fornecido', async () => {
    await service.gerarPacoteExportacao(99);

    expect(prismaMock.moradores.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.veiculos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.visitantes.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.prestadores_servico.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.encomendas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.ocorrencias.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
    expect(prismaMock.acessos_Facial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 99 }) }),
    );
  });
});
