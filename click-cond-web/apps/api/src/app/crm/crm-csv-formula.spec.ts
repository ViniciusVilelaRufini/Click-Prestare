import { CrmService } from './crm.service';

/**
 * O CSV do cliente no CRM leva texto que o próprio cliente digita — nome do
 * condomínio, nome/e-mail/telefone do síndico. Cada célula só escapava aspas:
 * um nome como `=HYPERLINK("http://x","Clique")` virava fórmula ativa ao abrir
 * a planilha. As outras exportações já passam por `csvCelula`.
 */
describe('CrmService.exportarClienteCsv — injeção de fórmula', () => {
  function build(cliente: any) {
    const svc = new CrmService({} as any, {} as any, {} as any);
    jest.spyOn(svc, 'cliente').mockResolvedValue(cliente);
    return svc;
  }

  const base = {
    id: 1, nome: 'Edifício Demo', identificacao: null, cidade: null, uf: null, estagio: 'ativo',
    plano: null, mrr: 0, vencimento: null, healthScore: 80, recorrenciaAtiva: false, cobrancaAutoWhats: false,
    contatoPrincipal: { nome: 'Síndico', email: 's@demo.com', telefone: '17 99999-0000' },
    totalApartamentos: 0, totalMoradores: 0, moradoresComFace: 0, moradoresComTag: 0, totalPorteiros: 0,
    totalFuncionarios: 0, dispositivosFaciais: 0, dispositivosOffline: 0, acessos30d: 0,
    encomendasAguardando: 0, encomendasRecebidas30d: 0, comunicados30d: 0, reservasAreas30d: 0,
    prestadoresCadastrados: 0, assembleiasAgendadas: 0, clienteDesde: null, ultimaAtividade: null,
  };

  const linha = (csv: string, indicador: string) => csv.split('\r\n').find((l) => l.startsWith(`${indicador},`) || l.startsWith(`"${indicador}",`));

  it('neutraliza fórmula no nome do condomínio e nos dados do síndico', async () => {
    const svc = build({
      ...base,
      nome: '=HYPERLINK("http://x","Clique")',
      contatoPrincipal: { nome: '+cmd|calc', email: '@SUM(A1)', telefone: '-2+3' },
    });
    const csv = (await svc.exportarClienteCsv(1))!;
    expect(linha(csv, 'Nome')).toBe(`Nome,"'=HYPERLINK(""http://x"",""Clique"")"`);
    expect(linha(csv, 'Sindico Nome')).toBe(`Sindico Nome,'+cmd|calc`);
    expect(linha(csv, 'Sindico Email')).toBe(`Sindico Email,'@SUM(A1)`);
    expect(linha(csv, 'Sindico Telefone')).toBe(`Sindico Telefone,'-2+3`);
  });

  it('texto comum continua igual e vírgula segue entre aspas', async () => {
    const svc = build({ ...base, nome: 'Residencial Sol, Bloco A' });
    const csv = (await svc.exportarClienteCsv(1))!;
    expect(csv.split('\r\n')[0]).toBe('Indicador,Valor');
    expect(linha(csv, 'Nome')).toBe('Nome,"Residencial Sol, Bloco A"');
  });
});
