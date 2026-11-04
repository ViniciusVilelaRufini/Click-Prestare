import { carregarSegredosSsm } from './segredos-ssm';

const ativo = () => ({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
const param = (n: string, v: string) => ({ Name: `/prestare/api/${n}`, Value: v });

describe('carregarSegredosSsm', () => {
  it('preenche só as variáveis ausentes ou vazias', async () => {
    const env = { ...ativo(), A: 'existente', B: '' } as NodeJS.ProcessEnv;
    const send = jest.fn().mockResolvedValue({ Parameters: [param('A', 'x'), param('B', 'y'), param('C', 'z')] });
    const n = await carregarSegredosSsm({ cliente: { send } as any, env });
    expect(n).toBe(2);
    expect(env.A).toBe('existente');
    expect(env.B).toBe('y');
    expect(env.C).toBe('z');
    expect(send.mock.calls[0][0].input).toMatchObject({ Path: '/prestare/api/', Recursive: false, WithDecryption: true });
  });

  it('pagina com NextToken', async () => {
    const env = ativo();
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Parameters: [param('P1', '1')], NextToken: 't' })
      .mockResolvedValueOnce({ Parameters: [param('P2', '2')] });
    expect(await carregarSegredosSsm({ cliente: { send } as any, env })).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.NextToken).toBe('t');
    expect(env.P2).toBe('2');
  });

  it('erro devolve 0 sem lançar', async () => {
    const send = jest.fn().mockRejectedValue(new Error('AccessDenied'));
    await expect(carregarSegredosSsm({ cliente: { send } as any, env: ativo() })).resolves.toBe(0);
  });

  it('inativo não chama a AWS', async () => {
    const send = jest.fn();
    const n = await carregarSegredosSsm({ cliente: { send } as any, env: {} as NodeJS.ProcessEnv });
    expect(n).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
