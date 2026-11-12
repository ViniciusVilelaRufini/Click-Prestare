import 'package:flutter/material.dart';

/// Entra no app depois do login: troca TODA a pilha por [destino].
///
/// Com `pushReplacement` sobrava a escolha de perfil por baixo do início, e o
/// Voltar do Android mostrava "Entrar como" para quem já estava logado.
Future<void> entrarLimpandoPilha(BuildContext context, Widget destino) {
  return Navigator.pushAndRemoveUntil(
    context,
    MaterialPageRoute(builder: (_) => destino),
    (route) => false,
  );
}
