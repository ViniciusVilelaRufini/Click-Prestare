import type { CreateMorador } from './moradores.service';

/** O que o formulário de edição recebeu do cadastro, para saber o que o operador mudou. */
export interface OriginalEdicaoMorador {
  id_apartamento: number | null | undefined;
  tag_rfid: string | null | undefined;
  qrcode_acesso: string | null | undefined;
  tipo?: string | null;
}

/**
 * Corpo do POST do cadastro novo. "Enviar credenciais" só vale com e-mail: sem ele nenhuma conta
 * de app é criada, e o pedido marcado fazia a API exigir a data de nascimento à toa.
 */
export function payloadCadastroMorador(novo: CreateMorador): CreateMorador {
  return { ...novo, sendCredentials: !!(novo.email ?? '').trim() && novo.sendCredentials !== false };
}

/** "Proprietário", "proprietario " e "PROPRIETARIO" são o mesmo tipo. */
function chaveTipo(tipo: string | null | undefined): string {
  return (tipo ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Corpo do PUT da edição de morador. Tag, QR, unidade e tipo só vão quando o operador os mudou:
 * reenviar o que veio vazio apagava a credencial, reenviar a unidade refazia os vínculos e reenviar
 * o tipo o regravava no vínculo.
 * A unidade trocada leva a anterior, para a API trocar só aquele vínculo.
 */
export function payloadEdicaoMorador(original: OriginalEdicaoMorador, novo: CreateMorador): Partial<CreateMorador> {
  const p: Partial<CreateMorador> = { ...novo };
  if ((novo.tag_rfid ?? '').trim() === (original.tag_rfid ?? '').trim()) delete p.tag_rfid;
  if ((novo.qrcode_acesso ?? '').trim() === (original.qrcode_acesso ?? '').trim()) delete p.qrcode_acesso;
  if (original.tipo !== undefined && chaveTipo(novo.tipo) === chaveTipo(original.tipo || 'proprietario')) delete p.tipo;
  const anterior = Number(original.id_apartamento) || 0;
  if ((Number(novo.id_apartamento) || 0) === anterior) {
    delete p.id_apartamento;
  } else {
    p.id_apartamento = Number(novo.id_apartamento);
    p.id_apartamento_anterior = anterior;
  }
  return p;
}
