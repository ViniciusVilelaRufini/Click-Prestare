/// Rodada de um pedido de autorização: o instante em que o porteiro pediu
/// (`auth_solicitado_em` na lista de pendentes, `chegouEm` no card ao vivo),
/// em segundos desde 1970.
///
/// Existe porque a API reaproveita o id da visita quando o porteiro pede de
/// novo para o mesmo visitante (visita sem entrada nem saída): o id sozinho
/// não separa o pedido já decidido do pedido novo.
///
/// Aceita número (segundos ou milissegundos), texto numérico ou ISO-8601.
/// Devolve null quando não dá para saber.
int? rodadaDoPedido(dynamic valor) {
  if (valor == null) return null;
  int? deNumero(num n) {
    final i = n.toInt();
    if (i <= 0) return null;
    // Acima disto é milissegundo (em segundos, só no ano 5138).
    return i > 100000000000 ? i ~/ 1000 : i;
  }

  if (valor is num) return deNumero(valor);
  final texto = valor.toString().trim();
  if (texto.isEmpty || texto == 'null') return null;
  final n = num.tryParse(texto);
  if (n != null) return deNumero(n);
  final data = DateTime.tryParse(texto);
  return data == null ? null : data.millisecondsSinceEpoch ~/ 1000;
}

class _Decisao {
  final int? rodada;
  final DateTime em;
  const _Decisao(this.rodada, this.em);
}

/// Garante que um pedido de autorização de entrada seja decidido uma vez só.
///
/// O pedido chega por três superfícies: o push (que abre diálogo sobre
/// qualquer tela), a PendentesVisitantePage, que faz poll a cada 10s, e o
/// AUTORIZAR da notificação do card no Android. Nenhuma sabia da outra, então
/// o FCM reentregando a mensagem abria um segundo diálogo, dois visitantes
/// chegando juntos empilhavam diálogos, e o mesmo id podia ser respondido duas
/// vezes.
///
/// Em todos esses casos quem paga é o porteiro, que fica com o visitante no
/// portão sem saber se o morador viu o pedido.
///
/// O "decidido" vale para a RODADA do pedido ([rodadaDoPedido]): o porteiro
/// pode pedir de novo com o mesmo id, e esse pedido novo precisa aparecer.
class ControleAutorizacoes {
  /// Instância compartilhada pelas superfícies — é justamente o fato de ser a
  /// mesma que impede duas delas de decidirem o mesmo id.
  static final ControleAutorizacoes instance = ControleAutorizacoes();

  /// Relógio (trocado no teste).
  DateTime Function() agora = DateTime.now;

  int? _dialogoAbertoPara;
  void Function(String fase)? _fecharDialogo;
  final Set<int> _emDecisao = {};
  final Map<int, _Decisao> _decididos = {};

  /// [rodada] null = não se sabe de qual pedido se trata: vale a decisão
  /// guardada (como antes). Com rodada, só o mesmo pedido (ou um mais antigo,
  /// resposta atrasada do servidor) conta como decidido.
  bool jaDecidido(int id, {int? rodada}) {
    final d = _decididos[id];
    if (d == null) return false;
    if (rodada == null) return true;
    if (d.rodada != null) return rodada <= d.rodada!;
    // Decidido sem saber a rodada: o pedido feito antes da decisão é o mesmo.
    return rodada * 1000 <= d.em.millisecondsSinceEpoch;
  }

  /// Pedido mais novo que o decidido para o mesmo id: esquece a decisão velha.
  void _renovar(int id, int? rodada) {
    if (rodada == null || !_decididos.containsKey(id)) return;
    if (jaDecidido(id, rodada: rodada)) return;
    _decididos.remove(id);
    _emDecisao.remove(id);
  }

  /// Só abre se não há outro diálogo na tela e este pedido ainda não foi resolvido.
  bool podeAbrirDialogo(int id, {int? rodada}) {
    _renovar(id, rodada);
    if (_dialogoAbertoPara != null) return false;
    if (jaDecidido(id, rodada: rodada)) return false;
    if (_emDecisao.contains(id)) return false;
    return true;
  }

  /// [fechar] tira o diálogo da tela quando o pedido acaba por fora (outro
  /// morador respondeu, venceu, a portaria encerrou, AUTORIZAR pela
  /// notificação).
  void abriu(int id, {void Function(String fase)? fechar}) {
    _dialogoAbertoPara = id;
    _fecharDialogo = fechar;
  }

  bool dialogoAbertoPara(int id) => _dialogoAbertoPara == id;

  /// Diálogo fechado sem decisão ("Decidir depois"): a solicitação continua
  /// pendente e precisa poder ser reaberta pela tela de pendentes.
  void fechou(int id) {
    if (_dialogoAbertoPara != id) return;
    _dialogoAbertoPara = null;
    _fecharDialogo = null;
  }

  /// Fecha o diálogo aberto para [id] (se houver), sem decidir nada.
  void fecharDialogoDe(int id, {String fase = 'encerrado'}) {
    if (_dialogoAbertoPara != id) return;
    final fechar = _fecharDialogo;
    _dialogoAbertoPara = null;
    _fecharDialogo = null;
    fechar?.call(fase);
  }

  /// Chegou por push a fase final do pedido (liberado, negado, expirado,
  /// entrou) ou o card foi encerrado. Fase final marca a rodada como
  /// decidida; `encerrado` só fecha o diálogo (a lista de pendentes, que lê o
  /// servidor, diz se ainda há o que decidir).
  void pedidoEncerrado(int id, String fase, {int? rodada}) {
    if (fase != 'encerrado') {
      final atual = _decididos[id];
      final maisNova = rodada != null && (atual?.rodada == null || rodada > atual!.rodada!);
      if (atual == null || maisNova) _decididos[id] = _Decisao(rodada, agora());
    }
    fecharDialogoDe(id, fase: fase);
  }

  /// Reserva o id para esta superfície. A primeira ganha; a segunda desiste.
  bool assumirDecisao(int id, {int? rodada}) {
    _renovar(id, rodada);
    if (jaDecidido(id, rodada: rodada) || _emDecisao.contains(id)) return false;
    _emDecisao.add(id);
    return true;
  }

  /// O POST falhou: devolve o id para que o morador possa tentar de novo.
  /// Se o pedido já foi decidido (por outra superfície ou por push de fase
  /// final), continua decidido.
  void desistiuDaDecisao(int id) => _emDecisao.remove(id);

  void decidiu(int id, {int? rodada}) {
    _emDecisao.remove(id);
    _decididos[id] = _Decisao(rodada, agora());
    if (_dialogoAbertoPara == id) {
      _dialogoAbertoPara = null;
      _fecharDialogo = null;
    }
  }
}
