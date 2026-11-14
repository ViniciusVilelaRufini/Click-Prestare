import { ForbiddenException } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService } from './assembleias.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O porteiro do console vê a lista de assembleias, mas "Painel de Pautas"
 * (`GET assembleias/get`) exigia Users.id e devolvia 403 "Sessão sem usuário
 * válido." — o token dele tem `sub` de Funcionarios_Portaria. Agora o
 * operador sem Users.id lê a assembleia e as pautas; os campos de voto
 * próprio (meusVotos, unidades, votosPorUnidade) vêm vazios.
 */
describe('assembleias/get — porteiro do console', () => {
  const porteiro: JwtPayload = { sub: 3, nome: 'João', id_condominio: 1, tipo_sub: 'funcionario_portaria' } as any;
  const morador: JwtPayload = { sub: 42, nome: 'Morador', typeAccess: 'Morador' };

  describe('controller', () => {
    function build() {
      const service: any = { get: jest.fn(async () => ({})) };
      return { ctrl: new AssembleiasController(service), service };
    }

    it('porteiro sem Users.id: chama o serviço sem usuário (não 403)', () => {
      const { ctrl, service } = build();
      ctrl.get('1', '2', porteiro);
      expect(service.get).toHaveBeenCalledWith(1, 2, null, porteiro);
    });

    it('morador: segue com o id dele', () => {
      const { ctrl, service } = build();
      ctrl.get('1', '2', morador);
      expect(service.get).toHaveBeenCalledWith(1, 2, 42, morador);
    });

    it('sessão sem usuário e sem condomínio: 403', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.get('1', '2', {} as JwtPayload)).toThrow(ForbiddenException);
      expect(service.get).not.toHaveBeenCalled();
    });
  });

  describe('service', () => {
    it('sem usuário: devolve assembleia e pautas, voto próprio vazio, sem consultar votos de ninguém', async () => {
      const prisma: any = {
        isConnected: true,
        assembleias: {
          findFirst: jest.fn(async () => ({
            id: 2, titulo: 'AGO', descricao: '', data: null, hora: null, link: '', local: '', anexos: '',
          })),
        },
        votacoes: {
          findMany: jest.fn(async () => [
            { id: 10, id_condominio: 1, titulo: 'Contas', descricao: '', data_inicio: null, data_termino: null, opcoes: [] },
          ]),
        },
        votacoes_Usuarios: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { findMany: jest.fn(async () => []) },
      };
      const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
      const service = new AssembleiasService(prisma, {} as any, tenant);

      const res: any = await service.get(1, 2, null, porteiro);

      expect(res.assembleia.titulo).toBe('AGO');
      expect(res.votacoes).toHaveLength(1);
      expect(res.meusVotos).toEqual([]);
      expect(res.unidades).toEqual([]);
      expect(res.votosPorUnidade).toEqual([]);
      expect(prisma.votacoes_Usuarios.findMany).not.toHaveBeenCalled();
      expect(prisma.apartamentos_Users.findMany).not.toHaveBeenCalled();
    });
  });
});
