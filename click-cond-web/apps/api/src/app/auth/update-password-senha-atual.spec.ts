import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';

/**
 * `POST /{sindico,morador,funcionarios}/new-password` recebia só a senha nova
 * e gravava o hash direto, sem nenhuma prova de que quem está do outro lado
 * conhece a senha atual. Combinado com JWT de 365 dias, isso significa que um
 * celular destravado por 30 segundos — ou um token vazado — vira tomada de
 * conta permanente, inclusive de síndico, que administra o condomínio inteiro.
 *
 * O app também não pedia a senha atual (modal_new_password.dart), então a
 * correção é dos dois lados. Aqui é a que importa: a validação do servidor.
 */
describe('updatePassword — exige a senha atual', () => {
  const SENHA_ATUAL = 'senhaAntiga123';
  const SENHA_NOVA = 'senhaNova456';

  async function build() {
    const hashAtual = await bcrypt.hash(SENHA_ATUAL, 10);
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({ id: 9, login: 'sindico@teste.com', password: hashAtual })),
        update: jest.fn(async ({ data }: any) => ({
          id: 9,
          login: 'sindico@teste.com',
          photo: null,
          password: data.password,
          sindicos: [{ id: 3, name: 'Síndico Teste' }],
          moradores: [],
          funcionarios: [],
          sindicosCondominios: [{ id_condominio: 2 }],
        })),
      },
    };
    const jwt = { sign: jest.fn(() => 'token-novo') };

    const service = new MobileAuthService(
      prisma,
      jwt as any,
      {} as any, // mail
      {} as any, // storage
      {} as any, // facial
      {} as any, // tenant
      {} as any, // financeiro
    );
    return { service, prisma, hashAtual };
  }

  it('NEGA quando a senha atual está errada', async () => {
    const { service, prisma } = await build();
    await expect(
      service.updatePassword(9, SENHA_NOVA, 'Sindico', 'chuteiEssaSenha'),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('NEGA quando a senha atual não foi enviada (cliente antigo)', async () => {
    const { service, prisma } = await build();
    await expect(service.updatePassword(9, SENHA_NOVA, 'Sindico', '')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('PERMITE quando a senha atual confere, e grava a nova com hash', async () => {
    const { service, prisma, hashAtual } = await build();
    const r = await service.updatePassword(9, SENHA_NOVA, 'Sindico', SENHA_ATUAL);

    expect(prisma.users.update).toHaveBeenCalledTimes(1);
    const gravado = prisma.users.update.mock.calls[0][0].data.password;
    expect(gravado).not.toBe(SENHA_NOVA); // nunca em texto puro
    expect(gravado).not.toBe(hashAtual); // e mudou de fato
    await expect(bcrypt.compare(SENHA_NOVA, gravado)).resolves.toBe(true);
    expect(r.access_token).toBe('token-novo');
  });

  /**
   * A senha nova precisa valer para o login seguinte; trocar por uma senha
   * idêntica à atual é ruído, mas não é erro de segurança — o que não pode
   * é a troca passar sem a prova de posse.
   */
  it('não vaza para o cliente se o usuário existe ou não', async () => {
    const { service, prisma } = await build();
    prisma.users.findUnique = jest.fn(async () => null);
    await expect(service.updatePassword(999, SENHA_NOVA, 'Sindico', SENHA_ATUAL)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
