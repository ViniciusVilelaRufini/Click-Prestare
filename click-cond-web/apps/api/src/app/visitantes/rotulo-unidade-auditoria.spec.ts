import { VisitantesService } from './visitantes.service';

/**
 * Bateria de produção 25/11: descrições de auditoria saíam "no Bloco Bloco A, Apto 106" porque o
 * cadastro já guarda o bloco como "Bloco A" e o rótulo prefixava de novo. O rótulo da unidade no
 * contexto de auditoria usa rotuloBloco (não duplica o prefixo; "A" continua virando "Bloco A").
 */
describe('VisitantesService — rótulo da unidade no contexto de auditoria', () => {
  const svc = Object.create(VisitantesService.prototype) as any;
  const visita = (bloco: string | null) => ({
    is_prestador: 0,
    pessoa: { id: 1, nome: 'Fulano', doc_identificacao: null },
    id_apartamento: 6,
    apartamento: { bloco, apto: '106' },
    data_hora_inicio: null,
    data_hora_termino: null,
    data_entrada: null,
    data_saida: null,
  });

  it('bloco já com prefixo não duplica', () => {
    expect(svc.construirContextoAuditoria(visita('Bloco A')).apartamento.label).toBe('Bloco A · Apto 106');
  });

  it('bloco só com a letra ganha o prefixo', () => {
    expect(svc.construirContextoAuditoria(visita('A')).apartamento.label).toBe('Bloco A · Apto 106');
  });

  it('sem bloco fica só o apto', () => {
    expect(svc.construirContextoAuditoria(visita(null)).apartamento.label).toBe('Apto 106');
  });
});
