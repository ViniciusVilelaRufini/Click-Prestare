import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
  AtualizarEntregadorDto,
  AtualizarStatusDeliveryDto,
  CriarDeliveryDto,
  CriarEntregadorDto,
} from './delivery.dto';

describe('DTOs de Delivery — ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  async function transformar(metatype: any, body: Record<string, unknown>) {
    return pipe.transform(body, { type: 'body', metatype, data: '' });
  }

  it.each([
    [CriarDeliveryDto, { id_condominio: 1, id_apartamento: 101, modo_entrega: 'UNIDADE' }, ['id_condominio', 'id_apartamento', 'modo_entrega']],
    [AtualizarStatusDeliveryDto, { status: 'CHEGOU', id_entregador: 7 }, ['status', 'id_entregador']],
    [CriarEntregadorDto, { id_condominio: 1, nome: 'Motoboy', veiculo: { placa: 'abc-1234' } }, ['id_condominio', 'nome', 'veiculo']],
    [AtualizarEntregadorDto, { status: 'BLOQUEADO', motivo_bloqueio: 'Ocorrência registrada' }, ['status', 'motivo_bloqueio']],
  ])('mantém campos permitidos de %p depois do whitelist', async (metatype, body, campos) => {
    const resultado = await transformar(metatype, { ...body, campo_externo: 'remover' });

    expect(resultado).toMatchObject(body);
    expect(resultado).not.toHaveProperty('campo_externo');
    expect(Object.keys(resultado)).toEqual(expect.arrayContaining(campos));
  });
});
