import { FacialDeviceClientService, FacialDeviceConfig } from './facial-device-client.service';

/**
 * Q4: no Control iD o face_id salvo é o id interno de UM aparelho — num
 * segundo Control iD aquele número é outra pessoa. O agente acha a pessoa em
 * cada aparelho pela matrícula (externalId), então update/remove precisam
 * levá-la junto ao comando. Sem ela (chamador antigo), o comando sai como antes.
 */
describe('FacialDeviceClientService — matrícula no update/remove pelo agente', () => {
  const dev: FacialDeviceConfig = {
    id: 7,
    ip: '192.168.1.50',
    porta: 80,
    api_user: 'admin',
    api_password: 'x',
    fabricante: 'control_id',
  };
  const agente = () => ({ isOnline: () => true, enqueue: jest.fn(async (..._args: any[]) => ({ ok: true })) });

  it('updatePerson leva o externalId do payload', async () => {
    const a = agente();
    await new FacialDeviceClientService(a as any).updatePerson(dev, '77', { externalId: 'morador_42', nome: 'Fulano' });
    expect(a.enqueue).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'update', faceId: '77', externalId: 'morador_42' }));
  });

  it('removePerson leva a matrícula quando o chamador a passa', async () => {
    const a = agente();
    await new FacialDeviceClientService(a as any).removePerson(dev, '77', 'morador_42');
    expect(a.enqueue).toHaveBeenCalledWith(7, { type: 'remove', faceId: '77', externalId: 'morador_42' });
  });

  it('Control iD em outra grafia ("Control iD") também leva a matrícula', async () => {
    const a = agente();
    const client = new FacialDeviceClientService(a as any);
    await client.updatePerson({ ...dev, fabricante: 'Control iD' }, '77', { externalId: 'morador_42', nome: 'F' });
    await client.removePerson({ ...dev, fabricante: 'Control iD' }, '77', 'morador_42');
    expect(a.enqueue.mock.calls[0][1]).toEqual(expect.objectContaining({ externalId: 'morador_42' }));
    expect(a.enqueue.mock.calls[1][1]).toEqual({ type: 'remove', faceId: '77', externalId: 'morador_42' });
  });

  it.each(['intelbras', 'dahua', 'hikvision'])(
    '%s: update e remove continuam pela MESMA chave (o face_id), sem externalId — senão o update gravaria a matrícula e o remove apagaria o face_id',
    async (fabricante) => {
      const a = agente();
      const client = new FacialDeviceClientService(a as any);
      const d = { ...dev, fabricante };
      await client.updatePerson(d, '77', { externalId: 'morador_42', nome: 'F' });
      await client.removePerson(d, '77', 'morador_42');
      const [update, remove] = a.enqueue.mock.calls.map((c) => c[1]);
      expect(update).toEqual(expect.objectContaining({ type: 'update', faceId: '77' }));
      expect(update).not.toHaveProperty('externalId');
      expect(remove).toEqual({ type: 'remove', faceId: '77' });
    },
  );

  it('sem matrícula, o comando sai como antes (sem campo externalId)', async () => {
    const a = agente();
    const client = new FacialDeviceClientService(a as any);
    await client.removePerson(dev, '77');
    await client.updatePerson(dev, '77', { nome: 'Fulano' });
    expect(a.enqueue.mock.calls[0][1]).toEqual({ type: 'remove', faceId: '77' });
    expect(a.enqueue.mock.calls[1][1]).not.toHaveProperty('externalId');
  });
});
