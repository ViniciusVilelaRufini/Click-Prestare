import { InterfoneFotoService, PREFIXOS_FOTO_INTERFONE } from './interfone-foto.service';
import { criarBancoFalso } from './banco-falso.spec';

const AGORA = Date.UTC(2026, 10, 27, 17, 0, 0);
const DIA = 86_400_000;

function montar(chamadas: any[] = [{ id: 1, id_condominio: 1, tipo: 'facial_unidade', estado: 'chamando', created_at: new Date(AGORA) }]) {
  const banco = criarBancoFalso({ interfone_Chamadas: chamadas });
  const agent = { enqueue: jest.fn(async () => ({ ok: true, imageBase64: 'AAAA' })) };
  const storage = {
    uploadDataUrl: jest.fn(async () => 'https://bucket.s3/interfone/1-x.jpg'),
    deleteUrl: jest.fn(async () => true),
  };
  const svc = new InterfoneFotoService(banco.prisma, agent as any, storage as any);
  svc.agora = () => AGORA;
  return { ...banco, agent, storage, svc };
}

describe('InterfoneFotoService.capturar', () => {
  it('snapshot ok grava a foto da chamada (prefixo interfone)', async () => {
    const m = montar();
    await m.svc.capturar(1, { id: 12, fabricante: 'intelbras' });
    expect(m.agent.enqueue).toHaveBeenCalledWith(12, { type: 'snapshot' });
    expect(m.storage.uploadDataUrl).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', 'interfone');
    expect(m.tabelas['interfone_Chamadas'][0].foto).toBe('https://bucket.s3/interfone/1-x.jpg');
  });

  it('fabricante sem câmera no registro não pede snapshot', async () => {
    const m = montar();
    await m.svc.capturar(1, { id: 12, fabricante: 'control_id' });
    await m.svc.capturar(1, { id: 12, fabricante: null });
    expect(m.agent.enqueue).not.toHaveBeenCalled();
  });

  it('agente offline (ok:false) não lança nem grava', async () => {
    const m = montar();
    m.agent.enqueue.mockResolvedValueOnce({ ok: false, error: 'Agente local não está conectado' } as any);
    await expect(m.svc.capturar(1, { id: 12, fabricante: 'dahua' })).resolves.toBeUndefined();
    expect(m.storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(m.tabelas['interfone_Chamadas'][0].foto).toBeNull();
  });

  it('storage sem bucket (devolve o data URL) não grava base64 na coluna', async () => {
    const m = montar();
    m.storage.uploadDataUrl.mockResolvedValueOnce('data:image/jpeg;base64,AAAA');
    await m.svc.capturar(1, { id: 12, fabricante: 'intelbras' });
    expect(m.tabelas['interfone_Chamadas'][0].foto).toBeNull();
  });

  it('erro em qualquer passo não lança', async () => {
    const m = montar();
    m.agent.enqueue.mockRejectedValueOnce(new Error('boom'));
    await expect(m.svc.capturar(1, { id: 12, fabricante: 'intelbras' })).resolves.toBeUndefined();
  });
});

describe('InterfoneFotoService.tickFotos', () => {
  it('apaga só as fotos de chamadas com mais de 90 dias', async () => {
    const m = montar([
      { id: 1, id_condominio: 1, tipo: 'facial_unidade', estado: 'encerrada', created_at: new Date(AGORA - 91 * DIA), foto: 'https://b/interfone/a.jpg' },
      { id: 2, id_condominio: 1, tipo: 'facial_unidade', estado: 'encerrada', created_at: new Date(AGORA - 89 * DIA), foto: 'https://b/interfone/b.jpg' },
      { id: 3, id_condominio: 1, tipo: 'facial_unidade', estado: 'encerrada', created_at: new Date(AGORA - 200 * DIA), foto: null },
    ]);
    await expect(m.svc.tickFotos()).resolves.toBe(1);
    expect(m.storage.deleteUrl).toHaveBeenCalledTimes(1);
    expect(m.storage.deleteUrl).toHaveBeenCalledWith('https://b/interfone/a.jpg', PREFIXOS_FOTO_INTERFONE);
    expect(m.tabelas['interfone_Chamadas'].map((c: any) => c.foto)).toEqual([null, 'https://b/interfone/b.jpg', null]);
  });

  it('arquivo que não apagou fica para a próxima passada', async () => {
    const m = montar([
      { id: 1, id_condominio: 1, tipo: 'facial_unidade', estado: 'encerrada', created_at: new Date(AGORA - 91 * DIA), foto: 'https://b/interfone/a.jpg' },
    ]);
    m.storage.deleteUrl.mockResolvedValueOnce(false);
    await expect(m.svc.tickFotos()).resolves.toBe(0);
    expect(m.tabelas['interfone_Chamadas'][0].foto).toBe('https://b/interfone/a.jpg');
  });
});
