import type { WebhookEventDto } from './facial.service';

/**
 * Tradução do push NATIVO dos aparelhos para o nosso WebhookEventDto.
 *
 * Por que existe: câmeras LPR e leitores de cartão não são programáveis como um
 * agente — elas postam um JSON de formato FIXO, definido pelo fabricante. Até
 * aqui o webhook só entendia o formato limpo (`placa`, `card_uid`, ...) e o
 * push do Control iD; qualquer câmera Hikvision ou Dahua/Intelbras apontada
 * para a nossa URL tinha a leitura descartada em silêncio, porque o campo
 * `placa` chegava vazio. Na prática, LPR só funcionava com um integrador no
 * meio convertendo o payload.
 *
 * Cada conversor devolve `null` quando o formato não é o dele — assim o
 * dispatcher tenta o próximo e, no fim, o payload limpo passa intacto.
 *
 * ATENÇÃO: os formatos seguem a documentação pública dos fabricantes e ainda
 * NÃO foram validados contra hardware real. Ao testar em campo, logue o corpo
 * cru recebido antes de ajustar qualquer campo aqui.
 */
export function normalizarPayloadNativo(raw: unknown): WebhookEventDto | null {
  return (
    hikvisionXml(raw) ??
    controlIdAccessLog(raw) ??
    hikvisionAnpr(raw) ??
    dahuaTrafficCar(raw) ??
    hikvisionAccessControl(raw) ??
    null
  );
}

/**
 * Hikvision em XML — o padrão de fábrica da notificação de evento (a câmera
 * posta `text/xml`, não JSON):
 *   <EventNotificationAlert>
 *     <eventType>ANPR</eventType>
 *     <dateTime>2026-08-17T11:00:00-03:00</dateTime>
 *     <ANPR><licensePlate>ABC1D23</licensePlate></ANPR>
 *   </EventNotificationAlert>
 *
 * Extraímos por tag em vez de trazer um parser de XML: os campos que
 * interessam são planos e o corpo vem de um aparelho, não de usuário.
 *
 * NÃO cobre o modo `multipart/form-data` (XML + foto da placa), usado por
 * alguns modelos de ANPR — nesse caso configure a câmera para o envio simples.
 */
function hikvisionXml(raw: unknown): WebhookEventDto | null {
  if (typeof raw !== 'string' || !raw.includes('<')) return null;
  const tag = (nome: string) => {
    const m = raw.match(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'i'));
    return m ? m[1].trim() : '';
  };
  const dateTime = isoValido(tag('dateTime'));
  const placa = tag('licensePlate') || tag('plateNumber');
  if (placa) {
    return { placa, event: 'recognized', timestamp: dateTime };
  }
  const employeeNo = tag('employeeNoString') || tag('employeeNo');
  const cardNo = tag('cardNo');
  if (employeeNo || cardNo) {
    const similarity = Number(tag('similarity'));
    return {
      external_id: employeeNo || undefined,
      person_id: employeeNo || undefined,
      card_uid: cardNo || undefined,
      event: 'recognized',
      confidence: Number.isFinite(similarity) && similarity > 0 ? similarity / 100 : undefined,
      timestamp: dateTime,
    };
  }
  return null;
}

/**
 * Control iD (Monitor, formato "object_changes"):
 *   { object_changes: [{ object: 'access_logs', values: {
 *       time, event, device_id, user_id, portal_id, ... } }], device_id }
 *
 * - user_id é o id INTERNO do aparelho — gravamos ele em face_id no
 *   enrollment, então o webhook resolve a pessoa por face_id.
 * - user_id "0" = ninguém identificado → acesso negado.
 * - Direção (entrada/saída) NÃO vem no log (depende do portal). Fica a cargo
 *   do device.sentido. Para catraca com entrada/saída separadas, mapear por
 *   portal_id futuramente.
 */
function controlIdAccessLog(raw: unknown): WebhookEventDto | null {
  const obj = raw as any;
  const changes = obj?.object_changes;
  if (!Array.isArray(changes)) return null;
  const entry = changes.find((c) => c?.object === 'access_logs' && c?.values);
  if (!entry) return null;
  const v = entry.values;
  const userId = v.user_id != null ? String(v.user_id) : '';
  const identificado = userId !== '' && userId !== '0';
  return {
    person_id: identificado ? userId : undefined,
    external_id: identificado ? userId : undefined,
    event: identificado ? 'access_granted' : 'access_denied',
    timestamp: v.time ? epochParaIso(v.time) : undefined,
  };
}

/**
 * Hikvision ANPR (câmera LPR), via HTTP Listening / notificação de evento:
 *   { eventType: 'ANPR', dateTime, ANPR: { licensePlate, country, ... } }
 * O mesmo corpo aparece embrulhado em `EventNotificationAlert` dependendo do
 * firmware — os dois casos caem aqui.
 *
 * A direção reportada pela câmera (`forward`/`reverse`) NÃO é mapeada de
 * propósito: ela descreve o sentido do movimento do veículo no quadro, que não
 * corresponde a entrar ou sair do condomínio (depende de como a câmera foi
 * instalada). Quem decide é o `sentido` configurado no terminal.
 */
function hikvisionAnpr(raw: unknown): WebhookEventDto | null {
  const obj = raw as any;
  const alerta = obj?.EventNotificationAlert ?? obj;
  const anpr = alerta?.ANPR;
  if (!anpr) return null;
  const placa = anpr.licensePlate ?? anpr.plateNumber;
  if (!placa) return null;
  return {
    placa: String(placa),
    event: 'recognized',
    timestamp: isoValido(alerta.dateTime),
  };
}

/**
 * Dahua / Intelbras ITS (câmera LPR), formato de evento de trânsito:
 *   { Events: [{ Code: 'TrafficJunction', Data: { PlateNumber, UTC, ... } }] }
 * Alguns firmwares postam um evento único, sem o array `Events`.
 */
function dahuaTrafficCar(raw: unknown): WebhookEventDto | null {
  const obj = raw as any;
  const eventos = Array.isArray(obj?.Events) ? obj.Events : [obj];
  const ev = eventos.find((e: any) => e?.Data?.PlateNumber);
  if (!ev) return null;
  const data = ev.Data;
  return {
    placa: String(data.PlateNumber),
    event: 'recognized',
    // UTC vem em segundos; alguns modelos mandam a hora formatada em `Time`.
    timestamp: data.UTC ? epochParaIso(data.UTC) : isoValido(data.Time),
  };
}

/**
 * Hikvision AccessControllerEvent — terminal de acesso (facial ou leitor de
 * cartão) postando direto na nuvem, sem passar pelo Agente Local:
 *   { eventType: 'AccessControllerEvent', dateTime,
 *     AccessControllerEvent: { employeeNoString, cardNo, ... } }
 *
 * `employeeNoString` é o nosso external_id (gravado como face_id no
 * enrollment). Quando só vem `cardNo`, tratamos como leitura de cartão — o
 * webhook resolve pela coluna tag_rfid.
 */
function hikvisionAccessControl(raw: unknown): WebhookEventDto | null {
  const obj = raw as any;
  const alerta = obj?.EventNotificationAlert ?? obj;
  const ev = alerta?.AccessControllerEvent;
  if (!ev) return null;
  const employeeNo = ev.employeeNoString ?? ev.employeeNo;
  const cardNo = ev.cardNo;
  if (!employeeNo && !cardNo) return null;
  return {
    external_id: employeeNo != null ? String(employeeNo) : undefined,
    person_id: employeeNo != null ? String(employeeNo) : undefined,
    card_uid: cardNo != null ? String(cardNo) : undefined,
    event: 'recognized',
    // similarity vem 0-100; a nuvem guarda a confiança como fração 0-1.
    confidence:
      typeof ev.similarity === 'number' ? ev.similarity / 100 : undefined,
    timestamp: isoValido(alerta.dateTime),
  };
}

/** Epoch em segundos → ISO. Ignora relógio zerado (aparelho sem NTP volta a 2000). */
function epochParaIso(valor: unknown): string | undefined {
  const seg = Number(valor);
  if (!Number.isFinite(seg) || seg < 1577836800 /* 2020-01-01 */) return undefined;
  return new Date(seg * 1000).toISOString();
}

/** Aceita a data do aparelho só se for parseável — senão o webhook usa a hora da nuvem. */
function isoValido(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || !valor) return undefined;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
