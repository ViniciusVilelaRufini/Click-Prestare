import type { CreateMorador } from './moradores.service';

/** O que o formulário de edição recebeu do cadastro, para saber o que o operador mudou. */
export interface OriginalEdicaoMorador {
  id_apartamento: number | null | undefined;
  tag_rfid: string | null | undefined;
  qrcode_acesso: string | null | undefined;
  tipo?: string | null;
  email?: string | null;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  data_nascimento?: string | null;
}

/**
 * Corpo do POST do cadastro novo. "Enviar credenciais" só vale com e-mail: sem ele nenhuma conta
 * de app é criada, e o pedido marcado fazia a API exigir a data de nascimento à toa.
 */
export function payloadCadastroMorador(novo: CreateMorador): CreateMorador {
  return { ...novo, sendCredentials: !!(novo.email ?? '').trim() && novo.sendCredentials !== false };
}

/**
 * Morador menor de 18 anos ao salvar. Cadastro novo: sem conta de app e sem rosto (a API recusa os
 * dois para menor sem o termo do responsável, que só existe depois, no app). Edição: não mexe em tipo
 * nem e-mail (um inquilino de 17 anos continua inquilino) e só avisa quando entra foto nova, pela
 * regra atual: menor com o termo do responsável aceito no app pode ter rosto nos terminais.
 */
export function ajusteMenorDeIdade(
  novo: CreateMorador,
  editando: boolean,
  fotoOriginal?: string | null,
): { aviso: string | null; ajuste: Partial<CreateMorador> } {
  if (!editando) {
    return {
      aviso: (novo.foto_pessoa ?? '').trim()
        ? 'A data informada torna o morador menor de idade. Sem o termo do responsável, aceito no app, o rosto não pode ser cadastrado: o morador será salvo como dependente, sem foto e sem acesso ao app.'
        : null,
      ajuste: { foto_pessoa: undefined, sendCredentials: false, tipo: 'dependente', email: '' },
    };
  }
  const foto = (novo.foto_pessoa ?? '').trim();
  const fotoNova = !!foto && foto !== (fotoOriginal ?? '').trim();
  return {
    aviso: fotoNova
      ? 'Morador menor de idade: o rosto só é aceito e vai para os terminais se o responsável já aceitou o termo de biometria no app. Sem o termo, a foto é recusada.'
      : null,
    ajuste: {},
  };
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
 * E-mail, fotos e nascimento também: reenviados, faziam a API exigir a data de nascimento até para
 * corrigir o telefone e rodar o sync facial de novo. "Enviar credenciais" não existe na edição.
 */
export function payloadEdicaoMorador(original: OriginalEdicaoMorador, novo: CreateMorador): Partial<CreateMorador> {
  const p: Partial<CreateMorador> = { ...novo };
  delete p.sendCredentials;
  const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();
  if (igual(novo.email, original.email)) delete p.email;
  if (igual(novo.foto_pessoa, original.foto_pessoa)) delete p.foto_pessoa;
  if (igual(novo.foto_documento, original.foto_documento)) delete p.foto_documento;
  if (igual((novo.data_nascimento ?? '').slice(0, 10), (original.data_nascimento ?? '').slice(0, 10))) delete p.data_nascimento;
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
