import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CriarVisitaDto } from './criar-visita.dto';

/**
 * Exercita exatamente o que o `ValidationPipe` global (main.ts,
 * `transform: true`) faz por trás das câmeras: `plainToInstance` +
 * `validate`. Sem isso, um teste que só chama `service.criarVisita(...)`
 * direto nunca passa pela validação de verdade — e foi assim que
 * `@ValidateNested()` sem `@IsDefined()` deixou passar um body sem `pessoa`
 * (Finding 1): o executor de nested validation do class-validator retorna
 * cedo quando o valor está `undefined`, então NENHUM erro era reportado.
 */
describe('CriarVisitaDto — validação (ValidationPipe)', () => {
  async function validarBody(body: Record<string, unknown>) {
    const instance = plainToInstance(CriarVisitaDto, body);
    return validate(instance);
  }

  it('rejeita um body sem `pessoa` (a causa do 500 do Finding 1)', async () => {
    const erros = await validarBody({ id_apartamento: 5 });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros.some((e) => e.property === 'pessoa')).toBe(true);
  });

  it('aceita um body com `pessoa` válida e `id_apartamento`', async () => {
    const erros = await validarBody({
      id_apartamento: 5,
      pessoa: { nome: 'Visitante Teste' },
      data_hora_inicio: '2026-09-19T10:00:00Z',
      data_hora_termino: '2026-09-19T18:00:00Z',
    });
    expect(erros).toHaveLength(0);
  });

  it('rejeita `pessoa` sem `nome` (validação desce para o objeto aninhado)', async () => {
    const erros = await validarBody({
      id_apartamento: 5,
      pessoa: { doc_identificacao: '11122233344' },
    });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros.some((e) => e.property === 'pessoa')).toBe(true);
  });

  it('rejeita data_hora_inicio inválida em vez de virar Invalid Date (Finding 3)', async () => {
    const erros = await validarBody({
      id_apartamento: 5,
      pessoa: { nome: 'Visitante Teste' },
      data_hora_inicio: 'banana',
    });
    expect(erros.some((e) => e.property === 'data_hora_inicio')).toBe(true);
  });

  it('rejeita data_hora_termino inválida', async () => {
    const erros = await validarBody({
      id_apartamento: 5,
      pessoa: { nome: 'Visitante Teste' },
      data_hora_termino: 'não-é-uma-data',
    });
    expect(erros.some((e) => e.property === 'data_hora_termino')).toBe(true);
  });

  it('aceita datas ISO válidas', async () => {
    const erros = await validarBody({
      id_apartamento: 5,
      pessoa: { nome: 'Visitante Teste' },
      data_hora_inicio: '2026-09-19T10:00:00Z',
      data_hora_termino: '2026-09-19T18:00:00Z',
    });
    expect(erros).toHaveLength(0);
  });
});
