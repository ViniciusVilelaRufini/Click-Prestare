import { ForbiddenException } from '@nestjs/common';
import { DeliveryService } from '../delivery.service';
import { DeliveryPortaoService } from './delivery-portao.service';
import { criarBancoFalso } from './banco-falso.spec';

/*
 * Montagem comum dos testes do autoatendimento no portão: banco falso,
 * DeliveryService de verdade (card e notificações falsos), facial e storage
 * falsos, relógio controlável. Arquivo .spec: fica fora do build.
 */
export const T0 = new Date('2026-11-14T15:00:00Z').getTime();
export const TOKEN_PORTAO = 'a'.repeat(48);
export const TOKEN_OUTRO_PORTAO = 'b'.repeat(48);
/** JPEG 16×16 de verdade (a selfie é decodificada antes de subir). */
export const FOTO =
  'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALwBkxf/2Q==';
export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVR4nGM4URFAEmIY1VAxGkonhmvSAAAe+5AQDWncSQAAAABJRU5ErkJggg==';
export const WEBP_B64 = 'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoQABAAAUAmJaACdLoB+AADsAD+2O7/4s5GI7PN/8zRMcx+vQAAAA==';
export const GIF_B64 = 'R0lGODlhEAAQAIAAAExpcch4UCH5BAUAAAAALAAAAAAQABAAAAIOjI+py+0Po5y02ouzPgUAOw==';

export function montarPortao(
  opts: {
    condominio?: Record<string, unknown>;
    dispositivos?: any[];
    atendimentos?: any[];
    pedidos?: any[];
    vinculos?: any[];
  } = {},
) {
  let agora = T0;
  const banco = criarBancoFalso(
    {
      condominios: [
        { id: 1, nome: 'Residencial Teste', ativo: 1, delivery_autoatendimento: true, delivery_auto_inicio: null, delivery_auto_fim: null, ...(opts.condominio ?? {}) },
        { id: 2, nome: 'Outro', ativo: 1, delivery_autoatendimento: true, delivery_auto_inicio: null, delivery_auto_fim: null },
      ],
      apartamentos: [
        { id: 102, id_condominio: 1, bloco: 'A', apto: '102' },
        { id: 101, id_condominio: 1, bloco: 'A', apto: '101' },
        { id: 110, id_condominio: 1, bloco: 'A', apto: '20' },
        { id: 201, id_condominio: 1, bloco: 'B', apto: '1' },
        { id: 900, id_condominio: 2, bloco: 'Z', apto: '1' },
      ],
      users: [
        { id: 7, name: 'Ana Lima', fcm_token: 'fcm-7', phone: '11999990000' },
        { id: 9, name: 'Bruno Reis', fcm_token: 'fcm-9', phone: '11999990001' },
      ],
      apartamentos_Users: opts.vinculos ?? [
        { id: 1, id_apto: 101, id_user: 7 },
        { id: 2, id_apto: 101, id_user: 9 },
      ],
      facial_Devices: opts.dispositivos ?? [
        { id: 30, id_condominio: 1, nome: 'Portão social', tipo: 'botoeira', ativo: 1, token_entrega: TOKEN_PORTAO },
        { id: 31, id_condominio: 1, nome: 'Portão de serviço', tipo: 'catraca', ativo: 1, token_entrega: TOKEN_OUTRO_PORTAO },
      ],
      deliveryAtendimentos: opts.atendimentos ?? [],
      deliveryPedidosPortao: opts.pedidos ?? [],
      deliveryEventos: [],
      deliveryEntregadores: [],
    },
    () => new Date(agora),
  );
  const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
  // Sessão do console com condomínio: só o dela. Sem condomínio no token (app): livre (o real confere vínculo).
  const tenant: any = {
    assertCondominio: jest.fn(async (id: number, user?: any) => {
      if (user?.id_condominio && user.id_condominio !== id) throw new ForbiddenException('Acesso negado: condomínio');
    }),
    assertEntidade: jest.fn(async () => undefined),
  };
  let fotos = 0;
  const storage: any = {
    uploadDataUrl: jest.fn(async () => `https://bucket.s3.amazonaws.com/delivery-portao/${++fotos}.jpg`),
    deleteUrl: jest.fn(async () => true),
    exigirArquivoDoRegistro: jest.fn(async () => undefined),
  };
  const card: any = {
    abrirDelivery: jest.fn(async () => undefined),
    atualizarDelivery: jest.fn(async () => ({ cobertos: new Set<string>() })),
    encerrarDeOutros: jest.fn(async () => undefined),
    encerrar: jest.fn(async () => undefined),
  };
  const facial: any = { abrirDispositivoInterno: jest.fn(async () => ({ ok: true })) };
  const delivery = new DeliveryService(banco.prisma, notifications, tenant, storage, card);
  (delivery as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const svc = new DeliveryPortaoService(banco.prisma, delivery, facial, storage, tenant);
  (svc as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
  svc.agora = () => agora;
  // Mesmo relógio nos dois serviços (prazo do pedido e janela do aviso reaproveitado).
  delivery.agora = () => agora;
  const avancar = (ms: number) => {
    agora += ms;
  };
  return { svc, delivery, banco, tabela: banco.tabela, storage, card, facial, notifications, avancar };
}

describe('montagem dos testes do portão', () => {
  it('liga o DeliveryPortaoService como gancho do DeliveryService', () => {
    const { svc, delivery } = montarPortao();
    expect((delivery as any).ganchoPortao).toBe(svc);
  });
});

