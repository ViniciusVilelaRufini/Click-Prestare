import { ForbiddenException } from '@nestjs/common';
import { RegrasAcessoController } from './regras-acesso.controller';
import { CaminhosAcessoController } from '../caminhos-acesso/caminhos-acesso.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Regras de acesso e caminhos de leitores são a POLÍTICA de controle de acesso
 * físico do prédio: quem passa em qual leitor, em que horário, e qual leitor
 * aciona qual abertura.
 *
 * O TenantGuard confere o condomínio da rota, mas morador pertence a ele —
 * e nenhum dos dois services tem autorização própria. Em `regras-acesso` o
 * módulo estava aberto por inteiro: um morador lia as regras e podia CRIAR
 * uma nova, liberando a si mesmo num leitor. Em `caminhos-acesso`, só as
 * mutações estavam protegidas; a leitura da topologia (o mapa de por onde se
 * entra) estava livre.
 */
describe('Política de acesso físico — exige operador', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiro: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  describe('regras-acesso', () => {
    function build() {
      const service: any = {
        findAll: jest.fn(async () => []),
        findOne: jest.fn(async () => ({})),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        remove: jest.fn(async () => ({})),
      };
      return { ctrl: new RegrasAcessoController(service), service };
    }

    it('NEGA morador criar regra de acesso — liberaria a si mesmo', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.create(1, {} as any, morador)).toThrow(ForbiddenException);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('NEGA morador ler as regras', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });

    it('NEGA morador editar e remover regra', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.update(1, 5, {} as any, morador)).toThrow(ForbiddenException);
      expect(() => ctrl.remove(1, 5, morador)).toThrow(ForbiddenException);
      expect(service.update).not.toHaveBeenCalled();
      expect(service.remove).not.toHaveBeenCalled();
    });

    it('PERMITE síndico e porteiro', () => {
      const { ctrl, service } = build();
      ctrl.list(1, sindico);
      ctrl.create(1, {} as any, porteiro);
      expect(service.findAll).toHaveBeenCalled();
      expect(service.create).toHaveBeenCalled();
    });
  });

  describe('caminhos-acesso', () => {
    function build() {
      const service: any = {
        findAll: jest.fn(async () => []),
        findOne: jest.fn(async () => ({})),
      };
      return { ctrl: new CaminhosAcessoController(service), service };
    }

    it('NEGA morador ler a topologia de leitores', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });

    it('NEGA morador abrir um caminho específico', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.get(1, 5, morador)).toThrow(ForbiddenException);
      expect(service.findOne).not.toHaveBeenCalled();
    });

    it('PERMITE operador', () => {
      const { ctrl, service } = build();
      ctrl.list(1, porteiro);
      expect(service.findAll).toHaveBeenCalled();
    });
  });
});
