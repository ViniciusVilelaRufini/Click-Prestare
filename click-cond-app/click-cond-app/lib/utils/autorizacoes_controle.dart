/// Garante que um pedido de autorização de entrada seja decidido uma vez só.
///
/// O pedido chega por duas superfícies simultâneas: o push (que abre diálogo
/// sobre qualquer tela) e a PendentesVisitantePage, que faz poll a cada 10s.
/// Nenhuma sabia da outra, então o FCM reentregando a mensagem abria um
/// segundo diálogo, dois visitantes chegando juntos empilhavam diálogos, e o
/// mesmo id podia ser respondido duas vezes.
///
/// Em todos esses casos quem paga é o porteiro, que fica com o visitante no
/// portão sem saber se o morador viu o pedido.
class ControleAutorizacoes {
  /// Instância compartilhada pelas duas superfícies — é justamente o fato de
  /// ser a mesma que impede as duas de decidirem o mesmo id.
  static final ControleAutorizacoes instance = ControleAutorizacoes();

  int? _dialogoAbertoPara;
  final Set<int> _emDecisao = {};
  final Set<int> _decididos = {};

  bool jaDecidido(int id) => _decididos.contains(id);

  /// Só abre se não há outro diálogo na tela e este id ainda não foi resolvido.
  bool podeAbrirDialogo(int id) {
    if (_dialogoAbertoPara != null) return false;
    if (_decididos.contains(id)) return false;
    if (_emDecisao.contains(id)) return false;
    return true;
  }

  void abriu(int id) => _dialogoAbertoPara = id;

  /// Diálogo fechado sem decisão ("Decidir depois"): a solicitação continua
  /// pendente e precisa poder ser reaberta pela tela de pendentes.
  void fechou(int id) {
    if (_dialogoAbertoPara == id) _dialogoAbertoPara = null;
  }

  /// Reserva o id para esta superfície. A primeira ganha; a segunda desiste.
  bool assumirDecisao(int id) {
    if (_decididos.contains(id) || _emDecisao.contains(id)) return false;
    _emDecisao.add(id);
    return true;
  }

  /// O POST falhou: devolve o id para que o morador possa tentar de novo.
  void desistiuDaDecisao(int id) {
    if (_decididos.contains(id)) return;
    _emDecisao.remove(id);
  }

  void decidiu(int id) {
    _emDecisao.remove(id);
    _decididos.add(id);
    if (_dialogoAbertoPara == id) _dialogoAbertoPara = null;
  }
}
