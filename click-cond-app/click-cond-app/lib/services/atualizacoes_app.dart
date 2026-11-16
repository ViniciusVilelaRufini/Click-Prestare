import 'dart:async';

import 'package:flutter/widgets.dart';

/// Assuntos que um aviso pode atualizar. As telas abertas assinam os que
/// mostram e recarregam quando chega um deles (ou [tudo]).
enum DominioApp { delivery, ocorrencia, reserva, visitante, encomenda, comunicado, enquete, tudo }

/// Assunto de um push pelo `type` do payload. Sem `type` conhecido, a
/// notificação comum do delivery (só `id_delivery` e `status`) é
/// [DominioApp.delivery]. `null` quando nenhuma tela precisa recarregar por
/// causa dele.
DominioApp? dominioDoPush(Map<String, dynamic> data) {
  final pelo = _dominioPeloTipo(data);
  if (pelo != null) return pelo;
  if (data['id_delivery'] != null) return DominioApp.delivery;
  return null;
}

DominioApp? _dominioPeloTipo(Map<String, dynamic> data) {
  switch (data['type']?.toString()) {
    case 'card_portaria':
      return data['origem']?.toString() == 'delivery' ? DominioApp.delivery : DominioApp.visitante;
    case 'autorizacao_visitante':
    case 'visitante':
    case 'visitante_acesso':
      return DominioApp.visitante;
    case 'ocorrencia':
    case 'ocorrencia_chat':
    case 'ocorrencia_atribuida':
      return DominioApp.ocorrencia;
    case 'reserva_status':
    case 'confirmacao_reserva':
      return DominioApp.reserva;
    case 'encomenda':
      return DominioApp.encomenda;
    case 'comunicado':
      return DominioApp.comunicado;
    case 'enquete':
    case 'assembleia':
      return DominioApp.enquete;
    default:
      return null;
  }
}

/// Canal único dos avisos de "algo mudou no servidor". O push em primeiro
/// plano emite o assunto dele; a volta do app ao primeiro plano emite [DominioApp.tudo].
class AtualizacoesApp {
  AtualizacoesApp._();

  static final StreamController<DominioApp> _controle = StreamController<DominioApp>.broadcast();

  static void avisar(DominioApp d) => _controle.add(d);

  static Stream<DominioApp> get stream => _controle.stream;
}

/// Assina os avisos dos [dominios] (e [DominioApp.tudo]). Quem assina cancela
/// a assinatura no `dispose`.
StreamSubscription<DominioApp> ouvirAtualizacoes(Set<DominioApp> dominios, VoidCallback recarregar) {
  return AtualizacoesApp.stream.listen((d) {
    if (d == DominioApp.tudo || dominios.contains(d)) recarregar();
  });
}

/// Emite [DominioApp.tudo] uma vez quando o app volta do segundo plano.
///
/// Só conta a volta de quem saiu da tela de fato (`hidden`/`paused`): puxar a
/// cortina de notificações ou abrir o diálogo da biometria passa só por
/// `inactive` e não deve recarregar tudo.
class ObservadorVoltaAoApp with WidgetsBindingObserver {
  bool _saiu = false;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden || state == AppLifecycleState.paused) {
      _saiu = true;
    } else if (state == AppLifecycleState.resumed && _saiu) {
      _saiu = false;
      AtualizacoesApp.avisar(DominioApp.tudo);
    }
  }
}
