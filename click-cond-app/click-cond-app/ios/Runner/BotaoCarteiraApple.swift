// Botão "Adicionar à Carteira Apple" nativo (PKAddPassButton) da tela Meu
// acesso. A Apple manda usar a classe PKAddPassButton em apps (o sistema
// desenha a arte e o idioma certos); o Flutter mostra este botão como uma
// platform view (UiKitView).
//
// View "prestare/botao_carteira_apple"
// (lib/pages/shared/meu_acesso/botao_carteira_apple.dart). Cada botão criado
// abre o canal "prestare/botao_carteira_apple/<id da view>":
//   → app: tocou()
// O app baixa o .pkpass e abre a folha do sistema (fluxo já existente).

import Flutter
import PassKit
import UIKit

final class BotaoCarteiraAppleFabrica: NSObject, FlutterPlatformViewFactory {
  static let tipo = "prestare/botao_carteira_apple"

  private let messenger: FlutterBinaryMessenger

  private init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  static func registrar(com registrar: FlutterPluginRegistrar) {
    registrar.register(BotaoCarteiraAppleFabrica(messenger: registrar.messenger()), withId: tipo)
  }

  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    return BotaoCarteiraAppleView(frame: frame, viewId: viewId, messenger: messenger)
  }
}

final class BotaoCarteiraAppleView: NSObject, FlutterPlatformView {
  private let container: UIView
  private let botao: PKAddPassButton
  private let canal: FlutterMethodChannel

  init(frame: CGRect, viewId: Int64, messenger: FlutterBinaryMessenger) {
    container = UIView(frame: frame)
    container.backgroundColor = .clear
    // Fundo escuro do app (Prestare Dark): estilo com contorno claro.
    botao = PKAddPassButton(addPassButtonStyle: .blackOutline)
    canal = FlutterMethodChannel(
      name: "\(BotaoCarteiraAppleFabrica.tipo)/\(viewId)",
      binaryMessenger: messenger
    )
    super.init()

    // O botão ocupa a área inteira que o Flutter dá à view (largura do
    // container, altura 48).
    botao.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(botao)
    NSLayoutConstraint.activate([
      botao.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      botao.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      botao.topAnchor.constraint(equalTo: container.topAnchor),
      botao.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    botao.addTarget(self, action: #selector(tocou), for: .touchUpInside)
  }

  func view() -> UIView {
    return container
  }

  @objc private func tocou() {
    canal.invokeMethod("tocou", arguments: nil)
  }
}
