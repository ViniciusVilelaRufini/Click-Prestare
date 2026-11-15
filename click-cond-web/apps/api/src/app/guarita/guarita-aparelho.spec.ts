import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { FacialService } from '../facial/facial.service';

/**
 * Cadastro do aparelho Guarita no facial: um por condomínio (I6), exclusão
 * protegida (I9) e a palavra de autorização validada em todo caminho (Menor).
 */

function facial(db: any) {
  const svc = Object.create(FacialService.prototype);
  svc.prisma = db;
  svc.logger = new Logger('teste');
  svc.auditoria = { registrar: jest.fn(async () => undefined) };
  svc.agent = { isOnline: () => false };
  return svc as any;
}

const GUARITA = { id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ip: '192.168.0.10', porta: 9000, api_password: 'Senha1' };

describe('I6 — um Módulo Guarita por condomínio', () => {
  it('o segundo Guarita ativo no mesmo condomínio → 400; em outro condomínio, ok', async () => {
    const db = criarBancoFalso();
    const svc = facial(db);
    await svc.createDevice(GUARITA);
    await expect(svc.createDevice({ ...GUARITA, ip: '192.168.0.11' })).rejects.toThrow('Esta versão aceita um Módulo Guarita por condomínio.');
    await expect(svc.createDevice({ ...GUARITA, id_condominio: 8 })).resolves.toMatchObject({ tipo: 'guarita' });
  });

  it('trocar o tipo de outro aparelho para guarita, ou reativar um segundo, também é recusado', async () => {
    const db = criarBancoFalso();
    const svc = facial(db);
    await svc.createDevice(GUARITA);
    const botoeira = await svc.createDevice({ id_condominio: 7, nome: 'Relé', tipo: 'botoeira', fabricante: 'genérico', ip: '192.168.0.20', porta: 80 });
    await expect(svc.updateDevice(botoeira.id, { tipo: 'guarita' })).rejects.toBeInstanceOf(BadRequestException);
    db.semear('facial_Devices', [{ id: 99, id_condominio: 7, nome: 'G antigo', tipo: 'guarita', fabricante: 'linear', ip: '1.1.1.1', porta: 9000, ativo: 0, webhook_token: 'x' }]);
    await expect(svc.updateDevice(99, { ativo: 1 })).rejects.toThrow('Esta versão aceita um Módulo Guarita por condomínio.');
  });
});
