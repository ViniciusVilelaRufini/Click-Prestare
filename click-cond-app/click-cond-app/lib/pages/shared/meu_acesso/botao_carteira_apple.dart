import 'dart:io';

import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Botão "Adicionar à Carteira Apple" da tela Meu acesso.
///
/// No iPhone é o botão NATIVO da Apple (`PKAddPassButton`, estilo
/// `.blackOutline` para o fundo escuro do app), mostrado como platform view —
/// a Apple manda usar essa classe em apps: o sistema desenha a arte e o idioma
/// certos. O código nativo está em ios/Runner/BotaoCarteiraApple.swift; cada
/// botão criado avisa o toque pelo canal `prestare/botao_carteira_apple/<id>`
/// (método `tocou`).
///
/// Fora do iPhone (testes de widget, sem plataforma) desenha um substituto
/// Prestare Dark com o mesmo rótulo de acessibilidade, que o teste toca.
class BotaoCarteiraApple extends StatefulWidget {
  const BotaoCarteiraApple({
    super.key,
    required this.aoTocar,
    this.ocupado = false,
    this.nativo,
  });

  final VoidCallback aoTocar;

  /// Pedido em andamento: o botão fica esmaecido e ignora toques.
  final bool ocupado;

  /// Ponto de troca para teste; padrão é usar o botão nativo só no iOS de verdade.
  final bool? nativo;

  static const tipoView = 'prestare/botao_carteira_apple';
  static const altura = 48.0;
  static const rotulo = 'Adicionar à Carteira da Apple';

  static bool get _plataformaNativa => !kIsWeb && Platform.isIOS;

  @override
  State<BotaoCarteiraApple> createState() => _BotaoCarteiraAppleState();
}

class _BotaoCarteiraAppleState extends State<BotaoCarteiraApple> {
  MethodChannel? _canal;

  @override
  void dispose() {
    _canal?.setMethodCallHandler(null);
    _canal = null;
    super.dispose();
  }

  void _criada(int id) {
    _canal?.setMethodCallHandler(null);
    _canal = MethodChannel('${BotaoCarteiraApple.tipoView}/$id')..setMethodCallHandler(_chamada);
  }

  Future<Object?> _chamada(MethodCall chamada) async {
    if (chamada.method == 'tocou' && mounted && !widget.ocupado) widget.aoTocar();
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (!(widget.nativo ?? BotaoCarteiraApple._plataformaNativa)) return _substituto();
    return SizedBox(
      width: double.infinity,
      height: BotaoCarteiraApple.altura,
      child: IgnorePointer(
        ignoring: widget.ocupado,
        child: Opacity(
          opacity: widget.ocupado ? 0.5 : 1,
          child: UiKitView(
            viewType: BotaoCarteiraApple.tipoView,
            onPlatformViewCreated: _criada,
            // O toque é do botão nativo mesmo dentro da rolagem da tela.
            gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
              Factory<TapGestureRecognizer>(() => TapGestureRecognizer()),
            },
          ),
        ),
      ),
    );
  }

  Widget _substituto() {
    return Semantics(
      button: true,
      label: BotaoCarteiraApple.rotulo,
      excludeSemantics: true,
      child: AppButton(
        label: BotaoCarteiraApple.rotulo,
        icon: PhosphorIcons.wallet,
        variant: AppButtonVariant.secondary,
        loading: widget.ocupado,
        onPressed: widget.ocupado ? null : widget.aoTocar,
      ),
    );
  }
}
