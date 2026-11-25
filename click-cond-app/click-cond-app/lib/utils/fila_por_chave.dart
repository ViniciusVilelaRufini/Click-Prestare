import 'dart:async';

/// Roda as tarefas de uma mesma chave uma depois da outra, na ordem em que
/// chegaram; chaves diferentes seguem em paralelo.
///
/// Existe pelo card ao vivo do Android: dois pushes seguidos do mesmo card
/// (`aguardando` e logo `encerrado`) rodavam juntos, cada um com E/S de
/// arquivo antes do `show`/`cancel`, e o que terminasse por último vencia —
/// o card encerrado voltava para a tela com os botões.
///
/// Nunca lança: a falha de uma tarefa vai para [aoFalhar] e não trava as
/// seguintes da mesma chave.
class FilaPorChave<K> {
  FilaPorChave({this.aoFalhar});

  final void Function(Object erro, StackTrace pilha)? aoFalhar;
  final Map<K, Future<void>> _filas = {};

  /// Quantas chaves têm tarefa em andamento (teste).
  int get chavesAtivas => _filas.length;

  Future<void> rodar(K chave, Future<void> Function() tarefa) {
    final anterior = _filas[chave] ?? Future<void>.value();
    late final Future<void> atual;
    atual = anterior.then((_) => tarefa()).catchError((Object e, StackTrace s) {
      aoFalhar?.call(e, s);
    }).whenComplete(() {
      if (identical(_filas[chave], atual)) _filas.remove(chave);
    });
    _filas[chave] = atual;
    return atual;
  }
}
