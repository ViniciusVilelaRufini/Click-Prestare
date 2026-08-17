import { normalizarPayloadNativo } from './webhook-payload.util';

/**
 * Push nativo dos aparelhos → nosso WebhookEventDto.
 *
 * Câmeras LPR e leitores de cartão postam um JSON de formato FIXO do
 * fabricante. Antes desta camada, só o push do Control iD era entendido: uma
 * câmera Hikvision ou Dahua apontada para a nossa URL tinha a leitura
 * descartada em silêncio, porque `placa` chegava vazio.
 *
 * Sem hardware para testar em campo — os formatos seguem a documentação
 * pública dos fabricantes.
 */
describe('normalizarPayloadNativo', () => {
  // O formato limpo (simulador, agente, integrações) precisa passar intacto:
  // devolver null é o sinal de "não é payload nativo, use o corpo original".
  it('ignora o formato limpo', () => {
    expect(normalizarPayloadNativo({ placa: 'ABC1D23' })).toBeNull();
    expect(normalizarPayloadNativo({ external_id: 'morador_42' })).toBeNull();
    expect(normalizarPayloadNativo({ card_uid: 'A1B2C3' })).toBeNull();
  });

  it('não estoura com corpo inesperado', () => {
    expect(normalizarPayloadNativo(null)).toBeNull();
    expect(normalizarPayloadNativo('texto')).toBeNull();
    expect(normalizarPayloadNativo({})).toBeNull();
    expect(normalizarPayloadNativo({ Events: [] })).toBeNull();
  });

  describe('Control iD (object_changes)', () => {
    it('converte acesso identificado', () => {
      const out = normalizarPayloadNativo({
        object_changes: [
          {
            object: 'access_logs',
            values: { user_id: 77, time: 1755440000, event: 7 },
          },
        ],
      });
      expect(out).toMatchObject({
        external_id: '77',
        person_id: '77',
        event: 'access_granted',
      });
      expect(out?.timestamp).toBe(new Date(1755440000 * 1000).toISOString());
    });

    // user_id 0 = ninguém identificado; precisa virar negado, não acesso.
    it('trata user_id 0 como negado', () => {
      const out = normalizarPayloadNativo({
        object_changes: [
          { object: 'access_logs', values: { user_id: 0, time: 1755440000 } },
        ],
      });
      expect(out?.event).toBe('access_denied');
      expect(out?.external_id).toBeUndefined();
    });

    // Aparelho sem NTP volta o relógio para 2000 ao perder energia. Carimbar o
    // acesso em 2000 o esconderia do histórico — melhor cair na hora da nuvem.
    it('descarta relógio zerado', () => {
      const out = normalizarPayloadNativo({
        object_changes: [
          { object: 'access_logs', values: { user_id: 5, time: 946684800 } },
        ],
      });
      expect(out?.timestamp).toBeUndefined();
    });
  });

  describe('Hikvision ANPR (LPR)', () => {
    it('extrai a placa do evento', () => {
      const out = normalizarPayloadNativo({
        eventType: 'ANPR',
        dateTime: '2026-08-17T11:00:00-03:00',
        ANPR: { licensePlate: 'ABC1D23', country: 'BRA' },
      });
      expect(out?.placa).toBe('ABC1D23');
      expect(out?.timestamp).toBe(new Date('2026-08-17T11:00:00-03:00').toISOString());
    });

    it('aceita o corpo embrulhado em EventNotificationAlert', () => {
      const out = normalizarPayloadNativo({
        EventNotificationAlert: { ANPR: { licensePlate: 'XYZ4321' } },
      });
      expect(out?.placa).toBe('XYZ4321');
    });

    // Evento ANPR sem placa (a câmera detectou veículo mas não leu) não pode
    // virar acesso: sem placa não há a quem atribuir.
    it('ignora evento sem placa', () => {
      expect(normalizarPayloadNativo({ ANPR: { country: 'BRA' } })).toBeNull();
    });
  });

  describe('Dahua / Intelbras ITS (LPR)', () => {
    it('extrai a placa do array Events', () => {
      const out = normalizarPayloadNativo({
        Events: [
          { Code: 'TrafficJunction', Data: { PlateNumber: 'ABC1D23', UTC: 1755440000 } },
        ],
      });
      expect(out?.placa).toBe('ABC1D23');
      expect(out?.timestamp).toBe(new Date(1755440000 * 1000).toISOString());
    });

    it('aceita evento único, sem array', () => {
      const out = normalizarPayloadNativo({
        Code: 'TrafficCar',
        Data: { PlateNumber: 'XYZ4321' },
      });
      expect(out?.placa).toBe('XYZ4321');
    });
  });

  // Formato de FÁBRICA da notificação Hikvision: a câmera posta text/xml, não
  // JSON. Sem este caminho o corpo chegava vazio e a placa era descartada.
  describe('Hikvision em XML', () => {
    it('extrai a placa do EventNotificationAlert', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <EventNotificationAlert>
          <eventType>ANPR</eventType>
          <dateTime>2026-08-17T11:00:00-03:00</dateTime>
          <ANPR><licensePlate>ABC1D23</licensePlate></ANPR>
        </EventNotificationAlert>`;
      const out = normalizarPayloadNativo(xml);
      expect(out?.placa).toBe('ABC1D23');
      expect(out?.timestamp).toBe(new Date('2026-08-17T11:00:00-03:00').toISOString());
    });

    it('extrai identificação de acesso do XML', () => {
      const xml = `<EventNotificationAlert>
          <AccessControllerEvent>
            <employeeNoString>morador_42</employeeNoString>
            <similarity>86</similarity>
          </AccessControllerEvent>
        </EventNotificationAlert>`;
      const out = normalizarPayloadNativo(xml);
      expect(out?.external_id).toBe('morador_42');
      expect(out?.confidence).toBe(0.86);
    });

    it('ignora XML sem nada aproveitável', () => {
      expect(normalizarPayloadNativo('<EventNotificationAlert></EventNotificationAlert>')).toBeNull();
    });
  });

  describe('Hikvision AccessControllerEvent', () => {
    it('resolve pelo employeeNoString (nosso external_id)', () => {
      const out = normalizarPayloadNativo({
        eventType: 'AccessControllerEvent',
        dateTime: '2026-08-17T11:00:00-03:00',
        AccessControllerEvent: { employeeNoString: 'morador_42', similarity: 86 },
      });
      expect(out?.external_id).toBe('morador_42');
      // Similarity vem 0-100; a nuvem guarda fração 0-1 (sem dividir, 86 vira 8600%).
      expect(out?.confidence).toBe(0.86);
    });

    it('trata leitura só de cartão como card_uid', () => {
      const out = normalizarPayloadNativo({
        AccessControllerEvent: { cardNo: '1234567' },
      });
      expect(out?.card_uid).toBe('1234567');
      expect(out?.external_id).toBeUndefined();
    });

    it('ignora evento sem identificação alguma', () => {
      expect(
        normalizarPayloadNativo({ AccessControllerEvent: { doorNo: 1 } }),
      ).toBeNull();
    });
  });
});
