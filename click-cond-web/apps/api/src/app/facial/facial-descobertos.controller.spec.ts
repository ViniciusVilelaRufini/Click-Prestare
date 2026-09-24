import { FacialController } from './facial.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';

/**
 * Rotas do portal para os aparelhos achados na rede pelo agente (etapa 3):
 *  - GET facial/descobertos devolve a última leitura do DescobertaService
 *    (recebido_em + achados + avisos de IP corrigido);
 *  - POST facial/descobertos/procurar marca o pedido de descoberta completa
 *    no próximo poll do agente.
 * Mesmo tenant check + assertOperador de agent/saude (spec vizinho
 * agent-telemetria.spec.ts): só operador do próprio condomínio.
 */
describe('GET/POST facial/descobertos', () => {
  const operadorDoCondominio = (id: number) => ({ sub: 3, nome: 'QA porteiro', id_condominio: id } as any);
  // Morador de verdade (app) nunca carrega id_condominio no JWT — é o que
  // faz isOperador() recusar (mesmo padrão de dashboard.papel.spec.ts).
  const moradorDoCondominio = (_id: number) => ({ sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any);

  function construirController({ descoberta }: { descoberta: any }) {
    return new FacialController(
      {} as any,
      new AgentBridgeService(),
      { getLatest: jest.fn(async () => ({ versao: null, url: null, sha256: null })) } as unknown as AgentVersionService,
      descoberta,
    );
  }

  it('lista descobertos só para operador do próprio condomínio', async () => {
    const descoberta = { listar: jest.fn(() => ({ recebido_em: null, achados: [], avisos: [] })), pedirProcura: jest.fn() };
    const ctrl = construirController({ descoberta });
    await expect(ctrl.descobertos(10, operadorDoCondominio(10))).resolves.toEqual({ recebido_em: null, achados: [], avisos: [] });
    await expect(ctrl.descobertos(10, operadorDoCondominio(11))).rejects.toThrow();
    await expect(ctrl.descobertos(10, moradorDoCondominio(10))).rejects.toThrow();
  });

  it('procurar marca o pedido do condomínio', async () => {
    const descoberta = { listar: jest.fn(), pedirProcura: jest.fn() };
    const ctrl = construirController({ descoberta });
    await expect(ctrl.procurarDescobertos(10, operadorDoCondominio(10))).resolves.toEqual({ ok: true });
    expect(descoberta.pedirProcura).toHaveBeenCalledWith(10);
  });
});
