import 'package:click/widgets/app/cabecalho_pessoa.dart';

/// Status de uma visita/pessoa no app — porte 1:1 da regra do console
/// (portaria-web `core/status-visitante.util.ts` e a ordem dos ramos de
/// `visitantes/rotulo-status-visita.util.ts`). Mude lá e aqui juntos.
///
/// Antes o app decidia o selo só pela janela de horário e mostrava
/// AUTORIZADO para quem o console dizia "Autorização expirada" (autorização
/// do morador de 12 dias atrás) — ignorava `liberado`, `auth_status`, a
/// validade de 10 min da autorização e a tolerância de 15 min da janela.

/// Validade da autorização do morador (API: common/autorizacao-expiracao.ts).
const Duration autorizacaoExpiracao = Duration(minutes: 10);

/// Tolerância após o fim da janela — a do terminal facial e do Validar PIN.
const Duration toleranciaJanela = Duration(minutes: 15);

enum StatusVisita { presente, liberado, autorizado, agendado, expirado, saiu }

/// A API manda 1/'1'/true; o console compara `=== 1`.
bool _um(dynamic v) {
  if (v == null) return false;
  if (v is bool) return v;
  if (v is num) return v == 1;
  final s = v.toString().trim().toLowerCase();
  return s == '1' || s == 'true';
}

bool _verdadeiro(dynamic v) => v == true || v == 1 || v == '1' || v == 'true';

bool _tem(dynamic v) => v != null && v.toString().trim().isNotEmpty && v.toString() != 'null';

/// Instante em ms desde a época (independe de fuso: ISO com Z é UTC).
int? _ms(dynamic v) {
  if (v == null) return null;
  if (v is DateTime) return v.millisecondsSinceEpoch;
  final d = DateTime.tryParse(v.toString());
  return d?.millisecondsSinceEpoch;
}

bool _presente(Map v) => _tem(v['data_entrada']) && !_tem(v['data_saida']);

/// Prestador, visitante recorrente ou com vaga vigente: a saída mantém a liberação.
bool _acessoContinuo(Map v) =>
    _um(v['liberado']) &&
    (_um(v['is_prestador']) || (v['dias_semana']?.toString() ?? '').trim().isNotEmpty || v['temVaga'] == true);

/// Pedido pendente ou autorizado há mais que 10 minutos (expirado).
bool autorizacaoExpirada(Map? p, DateTime agora) {
  if (p == null) return false;
  final agoraMs = agora.millisecondsSinceEpoch;
  final st = p['auth_status']?.toString();
  if (st == 'pendente') {
    final sol = _ms(p['auth_solicitado_em']);
    if (sol == null) return false;
    return agoraMs - sol > autorizacaoExpiracao.inMilliseconds;
  }
  if (st == 'autorizado') {
    if (_presente(p)) return false; // presente no condomínio
    final ref = _ms(p['auth_respondido_em']) ?? _ms(p['auth_solicitado_em']);
    if (ref == null) return false;
    return agoraMs - ref > autorizacaoExpiracao.inMilliseconds;
  }
  return false;
}

/// `autorizacao_expirada` da lista da portaria. O /visitantes/get-all do app
/// (resposta legada) não manda o campo: deriva-se do registro como a API faz
/// (visitantes.service, `autorizacaoExpirada` por apartamento): autorização
/// do morador vencida numa visita que não foi usada (sem entrada nem saída).
bool _flagAutorizacaoExpirada(Map v, DateTime agora) {
  if (v.containsKey('autorizacao_expirada') && v['autorizacao_expirada'] != null) {
    return _verdadeiro(v['autorizacao_expirada']);
  }
  return v['auth_status']?.toString() == 'autorizado' &&
      !_tem(v['data_entrada']) &&
      !_tem(v['data_saida']) &&
      autorizacaoExpirada(v, agora);
}

/// Liberado, mas a janela da visita já terminou (com a tolerância): o terminal recusa.
bool janelaEncerrada(Map v, DateTime agora) {
  if (!_um(v['liberado']) || _presente(v)) return false;
  final fim = _ms(v['data_hora_termino']);
  return fim != null && fim + toleranciaJanela.inMilliseconds < agora.millisecondsSinceEpoch;
}

StatusVisita statusVisita(Map v, DateTime agora) {
  final agoraMs = agora.millisecondsSinceEpoch;
  final liberado = _um(v['liberado']);
  if (_presente(v)) return StatusVisita.presente;
  if (_tem(v['data_saida']) && !_acessoContinuo(v)) return StatusVisita.saiu;
  if (_flagAutorizacaoExpirada(v, agora)) return StatusVisita.expirado;
  final inicio = _ms(v['data_hora_inicio']);
  if (liberado && inicio != null && inicio > agoraMs) return StatusVisita.agendado;
  if (liberado && !autorizacaoExpirada(v, agora)) {
    return janelaEncerrada(v, agora) ? StatusVisita.saiu : StatusVisita.liberado;
  }
  final fim = _ms(v['data_hora_termino']);
  if (liberado && inicio != null && fim != null) {
    if (agoraMs >= inicio && agoraMs <= fim) return StatusVisita.autorizado;
  }
  return StatusVisita.saiu;
}

/// Selo do app, na mesma ordem de ramos do rótulo do console.
StatusPessoa statusPessoaDaVisita(Map v, DateTime agora) {
  final s = statusVisita(v, agora);
  if (s == StatusVisita.presente) return StatusPessoa.noLocal;
  final expirada = autorizacaoExpirada(v, agora);
  final auth = v['auth_status']?.toString();
  if (auth == 'pendente' && !expirada) return StatusPessoa.aguardando;
  if (auth == 'autorizado' && !expirada) return StatusPessoa.autorizado;
  if (auth == 'negado' && !expirada) return StatusPessoa.finalizado;
  switch (s) {
    case StatusVisita.expirado:
      return StatusPessoa.expirado;
    case StatusVisita.liberado:
    case StatusVisita.autorizado:
      return StatusPessoa.autorizado;
    case StatusVisita.agendado:
      return StatusPessoa.agendado;
    case StatusVisita.presente:
    case StatusVisita.saiu:
      // Saiu de verdade (visita usada): finalizada, não "expirada".
      if (_tem(v['data_saida']) && !_acessoContinuo(v)) return StatusPessoa.finalizado;
      if (_verdadeiro(v['pedido_expirado']) || janelaEncerrada(v, agora) || expirada) {
        return StatusPessoa.expirado;
      }
      return StatusPessoa.finalizado;
  }
}

/// Visita que não vale mais para entrar (PIN e "Registrar entrada" somem):
/// janela encerrada além da tolerância, ou selo EXPIRADO. Quem está dentro
/// nunca é vencido.
bool visitaVencida(Map v, DateTime agora) {
  if (_presente(v)) return false;
  final fim = _ms(v['data_hora_termino']);
  if (fim != null && fim + toleranciaJanela.inMilliseconds < agora.millisecondsSinceEpoch) return true;
  return statusPessoaDaVisita(v, agora) == StatusPessoa.expirado;
}

/// Texto do selo (o mesmo de [CabecalhoPessoa]) para os selos simples das telas de detalhe.
String rotuloStatusPessoa(StatusPessoa s) {
  switch (s) {
    case StatusPessoa.noLocal:
      return 'NO LOCAL';
    case StatusPessoa.autorizado:
      return 'AUTORIZADO';
    case StatusPessoa.agendado:
      return 'AGENDADO';
    case StatusPessoa.aguardando:
      return 'AGUARDANDO';
    case StatusPessoa.expirado:
      return 'EXPIRADO';
    case StatusPessoa.finalizado:
      return 'FINALIZADO';
  }
}
