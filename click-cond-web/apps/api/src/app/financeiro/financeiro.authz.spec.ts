import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Antes desta correção, NENHUMA rota de mutação do financeiro (exceto a
 * limpeza administrativa) checava o papel do usuário — um Morador
 * autenticado no app conseguia remover lançamentos, marcar dívidas como
 * pagas, fechar competência, etc. de qualquer condomínio (ver
 * financeiro.tenant.spec.ts para o vazamento cross-tenant que acompanhava
 * isso). Estes testes provam que a checagem de papel (assertStaff) agora
 * bloqueia Morador nessas rotas, sem depender do isolamento de tenant.
 */
describe('assertStaff', () => {
  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const sindicoMobile: JwtPayload = { sub: 5, nome: 'Síndico X', typeAccess: 'Sindico' };
  const funcionarioMobile: JwtPayload = { sub: 5, nome: 'Porteiro', typeAccess: 'Funcionario' };
  const sindicoWeb: JwtPayload = { sub: 5, nome: 'Síndico Web', id_condominio: 2, typeAccess: 'Sindico' };

  it('NEGA morador (mobile, sem id_condominio)', () => {
    expect(() => assertStaff(morador, 'remover lançamento')).toThrow(ForbiddenException);
  });

  it('PERMITE síndico mobile', () => {
    expect(() => assertStaff(sindicoMobile)).not.toThrow();
  });

  it('PERMITE funcionário mobile', () => {
    expect(() => assertStaff(funcionarioMobile)).not.toThrow();
  });

  it('PERMITE síndico web (typeAccess no topo do payload)', () => {
    expect(() => assertStaff(sindicoWeb)).not.toThrow();
  });

  it('NEGA payload sem typeAccess reconhecido', () => {
    expect(() => assertStaff({ sub: 1, nome: 'Desconhecido' } as JwtPayload)).toThrow(ForbiddenException);
  });
});

/**
 * O financeiro do condomínio virou somente leitura: quem escreve é o ERP
 * Superlógica (e os webhooks de pagamento), não mais o síndico pelo app ou
 * pela portaria-web. Antes disso, estas rotas aceitavam síndico e
 * funcionário via `assertStaff`.
 *
 * O caso que estes testes protegem é o síndico, não o morador: morador já
 * era barrado. O síndico é quem tinha o botão na tela — e é o app já
 * instalado no celular dele que vai continuar chamando estas rotas depois
 * do deploy, até ele atualizar. Se a trava vivesse só na tela, essas
 * chamadas passariam.
 */
describe('FinanceiroController — financeiro do condomínio é somente leitura', () => {
  function buildController() {
    const service: any = {
      insert: jest.fn(), update: jest.fn(), remove: jest.fn(), updateStatus: jest.fn(),
      createRateio: jest.fn(), createAcordoInadimplente: jest.fn(), updateConfigAuto: jest.fn(),
      updateApartamentoRecorrencia: jest.fn(), parseOfxContent: jest.fn(), confirmarConciliacao: jest.fn(),
      getAll: jest.fn(), get: jest.fn(),
    };
    const fechamento: any = { fechar: jest.fn(), reabrir: jest.fn(), listar: jest.fn() };
    const controller = new FinanceiroController(service, fechamento);
    return { controller, service, fechamento };
  }

  /**
   * Varre o controller pelos metadados do Nest em vez de conferir uma lista
   * escrita à mão.
   *
   * A versão anterior deste teste era uma tabela manual com um comentário
   * afirmando que ela tornaria visível "uma mutação nova sem trava". Não
   * tornava: nada comparava a tabela com o controller real, e por isso
   * `upload-shared-file` — um @Post que grava `url_boleto` — passou por ela
   * sem falhar nada. A lista documentava a decisão; não a defendia.
   *
   * Agora cada @Post precisa estar numa das categorias abaixo, explicitamente.
   * Rota de escrita nova que ninguém classificar quebra o build.
   */
  describe('todo @Post do controller está classificado', () => {
    // Escritas legítimas que sobrevivem ao financeiro somente leitura, com o
    // motivo de cada uma. Acrescentar algo aqui é uma decisão, não um
    // detalhe.
    const ESCRITAS_PERMITIDAS: Record<string, string> = {
      'morador/insert': 'conta pessoal do morador — fora do escopo da restrição',
      'morador/update': 'conta pessoal do morador',
      'morador/remove': 'conta pessoal do morador',
      'upload-shared-file': 'comprovante da própria conta; boleto é recusado dentro do service',
      'inadimplente/notificar': 'comunicação, não altera dado financeiro',
      'webhook/asaas': 'gateway de pagamento (@Public, valida token)',
      'webhook/openpix': 'gateway de pagamento (@Public, valida token)',
      'admin/limpar-cobrancas-zeradas': 'operação de suporte, exige Admin',
    };

    function rotasPost(): string[] {
      const proto = FinanceiroController.prototype as any;
      return Object.getOwnPropertyNames(proto)
        .filter((m) => m !== 'constructor')
        .filter((m) => Reflect.getMetadata('method', proto[m]) === RequestMethod.POST)
        .map((m) => Reflect.getMetadata('path', proto[m]) as string);
    }

    // Guarda contra o teste passar a vazio. Se o Nest renomear as chaves de
    // metadado ('method'/'path'), `rotasPost()` devolve [] e os dois testes
    // abaixo ficam verdes sem checar nada — que é pior do que não existirem,
    // porque dão a impressão de cobertura.
    it('a varredura enxerga os @Post de verdade', () => {
      const rotas = rotasPost();
      expect(rotas.length).toBeGreaterThanOrEqual(10);
      expect(rotas).toContain('insert');
      expect(rotas).toContain('upload-shared-file');
    });

    it('nenhuma rota de escrita ficou sem classificação', () => {
      const semClassificacao = rotasPost().filter((rota) => {
        if (rota in ESCRITAS_PERMITIDAS) return false;
        // Não está na allowlist? Então tem de recusar.
        const metodo = Object.getOwnPropertyNames(FinanceiroController.prototype).find(
          (m) =>
            m !== 'constructor' &&
            Reflect.getMetadata('path', (FinanceiroController.prototype as any)[m]) === rota,
        )!;
        const controller = new FinanceiroController({} as any, {} as any);
        try {
          (controller as any)[metodo]();
          return true; // não lançou: escapou da trava
        } catch (e) {
          return !(e instanceof ForbiddenException);
        }
      });

      expect(semClassificacao).toEqual([]);
    });

    it('a lista de escritas permitidas não tem entrada morta', () => {
      // Entrada que sobra depois de uma rota ser removida vira permissão
      // fantasma: a próxima rota com aquele nome nasce liberada em silêncio.
      const existentes = new Set(rotasPost());
      const orfas = Object.keys(ESCRITAS_PERMITIDAS).filter((r) => !existentes.has(r));
      expect(orfas).toEqual([]);
    });
  });

  it('a recusa explica que a origem dos lançamentos é o ERP', () => {
    const { controller } = buildController();
    expect(() => controller.insert()).toThrow(/somente leitura/i);
    expect(() => controller.insert()).toThrow(/Superlógica/);
  });

  // A leitura não pode ter ido junto: o síndico continua abrindo o livro
  // caixa, o gráfico e a inadimplência. É o ponto inteiro da mudança —
  // tirar a escrita, manter a visualização.
  it('as leituras do síndico continuam de pé', () => {
    const { controller, service } = buildController();
    const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', sindico);
    expect(service.getAll).toHaveBeenCalled();
    controller.get('2', '10', sindico);
    expect(service.get).toHaveBeenCalled();
  });
});

describe('FinanceiroController.getAll — reconhece síndico independente do formato do JWT', () => {
  function buildController() {
    const service: any = { getAll: jest.fn() };
    const controller = new FinanceiroController(service, {} as any);
    return { controller, service };
  }

  it('isSindico=true para token com typeAccess no topo (formato usado em todo login mobile e web)', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', payload);
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', true, payload, false);
  });

  it('isSindico=false para morador', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Morador', typeAccess: 'Morador' };
    controller.getAll('2', '7', '2026', payload);
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', false, payload, false);
  });

  // O livro caixa não soma as taxas condominiais por padrão; quem quer o
  // total com elas pede explicitamente. Como o valor chega pela query string,
  // só a string 'true' liga — qualquer outra coisa mantém o padrão.
  it('incluirTaxasCondominiais só liga com a string "true"', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', payload, 'true');
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', true, payload, true);

    controller.getAll('2', '7', '2026', payload, '1');
    expect(service.getAll).toHaveBeenLastCalledWith(2, '7', '2026', true, payload, false);
  });
});
