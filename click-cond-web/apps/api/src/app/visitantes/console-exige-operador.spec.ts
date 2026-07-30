import { ForbiddenException } from '@nestjs/common';
import { VisitantesController } from './visitantes.controller';
import { PrestadoresController } from '../prestadores/prestadores.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * As rotas `condominios/:idCondominio/...` são o CONSOLE da portaria: elas
 * enxergam o condomínio inteiro. O TenantGuard confere o :idCondominio da
 * URL — mas morador também pertence ao condomínio, então ele sozinho não
 * separa quem opera a portaria de quem mora no prédio.
 *
 * O contraste estava escrito no próprio código: `findAllMobile`, que serve o
 * app, restringe TODO usuário (inclusive síndico) aos apartamentos a que está
 * vinculado, e o comentário diz que "ver todos" é exclusivo do console web.
 * Só que nada impunha esse "exclusivo" — qualquer morador autenticado
 * listava os visitantes do prédio inteiro com nome, documento e foto, e
 * podia reescrever ou apagar o cadastro de qualquer pessoa.
 */
describe('Console de visitantes/prestadores — exige operador', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindicoApp: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiroWeb: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  describe('VisitantesController', () => {
    function build() {
      const service: any = {
        findAll: jest.fn(async () => []),
        listarPessoas: jest.fn(async () => []),
        buscarPessoa: jest.fn(async () => []),
        detalhes: jest.fn(async () => ({})),
        atualizarPessoa: jest.fn(async () => ({})),
        removerPessoa: jest.fn(async () => ({ ok: true })),
        novaVisitaParaPessoa: jest.fn(async () => ({})),
      };
      return { ctrl: new VisitantesController(service), service };
    }

    it('NEGA morador listar os visitantes do prédio', async () => {
      const { ctrl, service } = build();
      await expect(ctrl.list(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });

    it('NEGA morador listar as pessoas cadastradas', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.pessoas(1, morador)).toThrow(ForbiddenException);
      expect(service.listarPessoas).not.toHaveBeenCalled();
    });

    it('NEGA morador buscar pessoa por documento', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.buscarPessoa(1, morador, '232.323.232-33')).toThrow(ForbiddenException);
      expect(service.buscarPessoa).not.toHaveBeenCalled();
    });

    it('NEGA morador abrir detalhes (histórico, doc e fotos)', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.detalhes(5, morador)).toThrow(ForbiddenException);
      expect(service.detalhes).not.toHaveBeenCalled();
    });

    it('NEGA morador reescrever o cadastro de uma pessoa (inclusive a tag RFID)', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.atualizarPessoa(1, 5, { nome: 'Outro', tag_rfid: 'ABC123' }, morador))
        .toThrow(ForbiddenException);
      expect(service.atualizarPessoa).not.toHaveBeenCalled();
    });

    it('NEGA morador apagar o cadastro e todas as visitas de uma pessoa', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.removerPessoa(1, 5, morador)).toThrow(ForbiddenException);
      expect(service.removerPessoa).not.toHaveBeenCalled();
    });

    it('NEGA morador copiar identidade alheia numa nova visita', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.novaVisitaPessoa(5, { id_apartamento: 1 }, morador))
        .toThrow(ForbiddenException);
      expect(service.novaVisitaParaPessoa).not.toHaveBeenCalled();
    });

    it('PERMITE operador da portaria-web', async () => {
      const { ctrl, service } = build();
      await ctrl.list(1, porteiroWeb);
      expect(service.findAll).toHaveBeenCalled();
    });

    it('PERMITE síndico do app', async () => {
      const { ctrl, service } = build();
      await ctrl.list(1, sindicoApp);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('PrestadoresController', () => {
    function build() {
      const service: any = {
        findAll: jest.fn(async () => []),
        findOne: jest.fn(async () => ({})),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        clearFoto: jest.fn(async () => ({})),
        remove: jest.fn(async () => ({})),
      };
      return { ctrl: new PrestadoresController(service), service };
    }

    it('NEGA morador editar prestador pelo console', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.update(1, 5, { nome: 'X' }, morador)).toThrow(ForbiddenException);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('NEGA morador remover prestador pelo console', async () => {
      const { ctrl, service } = build();
      await expect(ctrl.remove(1, 5, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.remove).not.toHaveBeenCalled();
    });

    /**
     * Faltava o `await`: a resposta era `{ ok: true }` imediata, antes de
     * saber se a exclusão aconteceu. Falha de tenant, de FK ou de banco
     * virava sucesso na tela — e unhandled rejection no processo.
     */
    it('remove espera o service e propaga a falha em vez de responder ok', async () => {
      const { ctrl, service } = build();
      service.remove = jest.fn(async () => {
        throw new Error('Foreign key constraint violated');
      });
      await expect(ctrl.remove(1, 5, porteiroWeb)).rejects.toThrow('Foreign key');
    });

    it('PERMITE operador remover, respondendo ok só depois de concluir', async () => {
      const { ctrl, service } = build();
      const r = await ctrl.remove(1, 5, porteiroWeb);
      expect(service.remove).toHaveBeenCalled();
      expect(r).toEqual({ ok: true });
    });
  });
});
