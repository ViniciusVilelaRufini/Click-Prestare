import 'package:click/services/push_condominio.dart';

/// Telas que o toque num push pode abrir.
enum TelaPush {
  pendentes,
  historicoAcessos,
  encomendas,
  delivery,
  ocorrencia,
  ocorrenciaChat,
  ocorrencias,
  financeiro,
  reservas,
  comunicado,
  comunicados,
  assembleia,
  assembleias,
  enquete,
  enquetes,
  convites,
}

/// Para onde o toque num push leva: a tela, o id do assunto (quando a tela
/// abre um item) e o condomínio do push ([condominioDoPush]).
class DestinoPush {
  final TelaPush tela;
  final int? id;
  final int? idCondominio;
  const DestinoPush(this.tela, {this.id, this.idCondominio});
}

/// Tipo do push. O push comum do delivery (`delivery.service.ts` e o
/// `pushComumDelivery` do card) leva só `{id_delivery, status}`, sem `type`:
/// sem isto o toque nele não fazia nada.
String? tipoDoPush(Map<String, dynamic> data) {
  final tipo = data['type']?.toString().trim() ?? '';
  if (tipo.isNotEmpty) return tipo;
  final idDelivery = data['id_delivery']?.toString().trim() ?? '';
  if (idDelivery.isNotEmpty) return 'delivery';
  return null;
}

int? _idPositivo(dynamic v) {
  final id = int.tryParse('${v ?? ''}'.trim());
  return id != null && id > 0 ? id : null;
}

/// Destino do toque num push do tipo [tipo] (ver [tipoDoPush]); null = o
/// app só abre (tipo sem tela). O mesmo que a central de notificações abre
/// (`notificacoes_page.dart` `_abrir`), mais os tipos que só existem no push.
DestinoPush? destinoDoPush(String tipo, Map<String, dynamic> data) {
  final id = _idPositivo(data['id']);
  final cond = condominioDoPush(data);
  if (tipo.startsWith('reserva_cancelada')) return DestinoPush(TelaPush.reservas, id: id, idCondominio: cond);
  switch (tipo) {
    case 'autorizacao_visitante':
      return DestinoPush(TelaPush.pendentes, id: id, idCondominio: cond);
    case 'visitante':
    case 'visitante_acesso':
      return const DestinoPush(TelaPush.historicoAcessos);
    case 'encomenda':
      return DestinoPush(TelaPush.encomendas, id: id, idCondominio: cond);
    case 'delivery':
      return DestinoPush(TelaPush.delivery, id: _idPositivo(data['id_delivery']) ?? id, idCondominio: cond);
    case 'ocorrencia':
    case 'ocorrencia_atribuida':
      return DestinoPush(id != null ? TelaPush.ocorrencia : TelaPush.ocorrencias, id: id, idCondominio: cond);
    case 'ocorrencia_chat':
      return DestinoPush(id != null ? TelaPush.ocorrenciaChat : TelaPush.ocorrencias, id: id, idCondominio: cond);
    case 'financeiro':
      return DestinoPush(TelaPush.financeiro, idCondominio: cond);
    case 'confirmacao_reserva':
    case 'reserva_status':
      return DestinoPush(TelaPush.reservas, id: id, idCondominio: cond);
    case 'comunicado':
      return DestinoPush(id != null ? TelaPush.comunicado : TelaPush.comunicados, id: id, idCondominio: cond);
    case 'assembleia':
      return DestinoPush(id != null ? TelaPush.assembleia : TelaPush.assembleias, id: id, idCondominio: cond);
    // O id da ATA não é o da assembleia: abre a lista (onde a ATA aparece).
    case 'ata':
      return DestinoPush(TelaPush.assembleias, idCondominio: cond);
    case 'enquete':
      return DestinoPush(id != null ? TelaPush.enquete : TelaPush.enquetes, id: id, idCondominio: cond);
    case 'convite_visita':
      return const DestinoPush(TelaPush.convites);
    default:
      return null;
  }
}
