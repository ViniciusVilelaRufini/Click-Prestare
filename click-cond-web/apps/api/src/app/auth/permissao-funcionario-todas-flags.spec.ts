import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';

/**
 * A tabela Funcionarios tem OITO flags de permissão, e o app respeita todas —
 * `getUserPermission('areas_sociais') == 1` decide se o botão aparece. Mas
 * `assertPermissaoFuncionario` só aceitava duas (`cadastrar_visitante` e
 * `prestadores_servico`): para as outras seis não havia enforcement nenhum no
 * servidor, então bastava chamar a rota direto para contornar.
 *
 * O efeito prático é pior do que "falta uma checagem": o síndico desliga um
 * módulo na tela de permissões acreditando que restringiu o funcionário, e não
 * restringiu nada. Caso concreto encontrado no review: qualquer funcionário,
 * mesmo sem `agendar_mudanca`, aprovava ou recusava mudança — a ação que de
 * fato libera o elevador e a portaria.
 */
describe('assertPermissaoFuncionario — todas as flags', () => {
  const TODAS = [
    'areas_sociais',
    'comunicados',
    'ocorrencias',
    'manutencoes_programadas',
    'prestadores_servico',
    'agendar_mudanca',
    'cadastrar_visitante',
    'apartamentos',
  ] as const;

  /**
   * O mock honra o `select` de propósito: é o que o Prisma faz. Um mock que
   * devolve todas as colunas esconderia justamente o defeito — a consulta
   * buscava só duas flags, então qualquer outra chegava como `undefined` e
   * caía no `?? 0`, negando até quem tinha a permissão ligada.
   */
  function build(flags: Record<string, unknown> | null) {
    const prisma: any = {
      isConnected: true,
      funcionarios: {
        findFirst: jest.fn(async ({ select }: any) => {
          if (!flags) return null;
          const colunas = Object.keys(select ?? {});
          return Object.fromEntries(colunas.map((c) => [c, flags[c]]));
        }),
      },
    };
    return { service: new TenantAccessService(prisma), prisma };
  }

  const funcionario: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  const ligadas = Object.fromEntries(TODAS.map((f) => [f, 1]));
  const desligadas = Object.fromEntries(TODAS.map((f) => [f, 0]));

  it.each(TODAS)('NEGA funcionário com %s desligada', async (flag) => {
    const { service } = build(desligadas);
    await expect(service.assertPermissaoFuncionario(2, flag, funcionario)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each(TODAS)('PERMITE funcionário com %s ligada', async (flag) => {
    const { service } = build(ligadas);
    await expect(service.assertPermissaoFuncionario(2, flag, funcionario)).resolves.toBeUndefined();
  });

  it('a flag pedida é a que decide — as outras não salvam', async () => {
    // Só areas_sociais ligada; pedir ocorrencias tem que negar.
    const { service } = build({ ...desligadas, areas_sociais: 1 });
    await expect(service.assertPermissaoFuncionario(2, 'ocorrencias', funcionario)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.assertPermissaoFuncionario(2, 'areas_sociais', funcionario),
    ).resolves.toBeUndefined();
  });

  it('não se aplica a síndico', async () => {
    const { service, prisma } = build(desligadas);
    await expect(
      service.assertPermissaoFuncionario(2, 'ocorrencias', sindico),
    ).resolves.toBeUndefined();
    expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });

  it('nega funcionário que não trabalha neste condomínio', async () => {
    const { service } = build(null);
    await expect(service.assertPermissaoFuncionario(2, 'ocorrencias', funcionario)).rejects.toThrow(
      ForbiddenException,
    );
  });

  /**
   * A flag vem do MySQL e pode chegar como "1" (String) ou como boolean
   * dependendo do driver — tratar só o int deixaria passar ou barrar errado.
   */
  it('aceita a flag como String', async () => {
    const { service } = build({ ...desligadas, ocorrencias: '1' } as any);
    await expect(
      service.assertPermissaoFuncionario(2, 'ocorrencias', funcionario),
    ).resolves.toBeUndefined();
  });

  it('seleciona a flag pedida na consulta', async () => {
    const { service, prisma } = build(ligadas);
    await service.assertPermissaoFuncionario(2, 'agendar_mudanca', funcionario);
    const args = prisma.funcionarios.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id_user: 5, id_condominio: 2 });
    expect(args.select).toHaveProperty('agendar_mudanca', true);
  });
});
