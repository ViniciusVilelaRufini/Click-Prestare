import type { CreateMorador } from './moradores.service';

/** O que o formulário de edição recebeu do cadastro, para saber o que o operador mudou. */
export interface OriginalEdicaoMorador {
  id_apartamento: number | null | undefined;
  tag_rfid: string | null | undefined;
  qrcode_acesso: string | null | undefined;
}

/**
 * Corpo do PUT da edição de morador. Tag, QR e unidade só vão quando o operador os mudou:
 * reenviar o que veio vazio apagava a credencial, e reenviar a unidade refazia os vínculos.
 * A unidade trocada leva a anterior, para a API trocar só aquele vínculo.
 */
export function payloadEdicaoMorador(original: OriginalEdicaoMorador, novo: CreateMorador): Partial<CreateMorador> {
  const p: Partial<CreateMorador> = { ...novo };
  if ((novo.tag_rfid ?? '').trim() === (original.tag_rfid ?? '').trim()) delete p.tag_rfid;
  if ((novo.qrcode_acesso ?? '').trim() === (original.qrcode_acesso ?? '').trim()) delete p.qrcode_acesso;
  const anterior = Number(original.id_apartamento) || 0;
  if ((Number(novo.id_apartamento) || 0) === anterior) {
    delete p.id_apartamento;
  } else {
    p.id_apartamento = Number(novo.id_apartamento);
    p.id_apartamento_anterior = anterior;
  }
  return p;
}
