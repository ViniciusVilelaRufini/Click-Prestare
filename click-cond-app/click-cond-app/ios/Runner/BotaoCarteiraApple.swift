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
    AdicionarPasseApple.shared.registrar(messenger: registrar.messenger())
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

// Folha da Apple de adicionar passe (PKAddPassesViewController).
//
// Abrir o .pkpass como arquivo (Quick Look) mostra só um ícone de "Tíquete"
// e obriga o morador a compartilhar para a Carteira. O caminho certo é
// montar o PKPass com os bytes e apresentar a folha da Carteira.
//
// Canal "prestare/carteira_apple":
//   app → adicionarPasse(bytes: FlutterStandardTypedData)
//     sucesso: "fechado" (a folha foi fechada; o app relê a situação)
//     erro "carteira_indisponivel": o aparelho não aceita passes
//     erro "passe_invalido": o PKPass não abriu (mensagem do sistema em message)
//     erro "sem_tela": não havia tela para apresentar a folha
final class AdicionarPasseApple: NSObject, PKAddPassesViewControllerDelegate {
  static let shared = AdicionarPasseApple()
  static let nomeDoCanal = "prestare/carteira_apple"

  private var canal: FlutterMethodChannel?
  private var pendente: FlutterResult?

  func registrar(messenger: FlutterBinaryMessenger) {
    let canal = FlutterMethodChannel(name: AdicionarPasseApple.nomeDoCanal, binaryMessenger: messenger)
    canal.setMethodCallHandler { [weak self] chamada, resultado in
      guard chamada.method == "adicionarPasse" else {
        resultado(FlutterMethodNotImplemented)
        return
      }
      guard let dados = chamada.arguments as? FlutterStandardTypedData else {
        resultado(FlutterError(code: "passe_invalido", message: "Arquivo do passe ausente.", details: nil))
        return
      }
      self?.apresentar(dados.data, resultado: resultado)
    }
    self.canal = canal
  }

  private func apresentar(_ dados: Data, resultado: @escaping FlutterResult) {
    guard PKAddPassesViewController.canAddPasses() else {
      resultado(FlutterError(code: "carteira_indisponivel", message: "Este aparelho não aceita passes da Carteira.", details: nil))
      return
    }
    let passe: PKPass
    do {
      passe = try PKPass(data: dados)
    } catch {
      resultado(FlutterError(code: "passe_invalido", message: error.localizedDescription, details: nil))
      return
    }
    guard let folha = PKAddPassesViewController(pass: passe) else {
      resultado(FlutterError(code: "passe_invalido", message: "A Carteira recusou o passe.", details: nil))
      return
    }
    guard let tela = AdicionarPasseApple.telaDoTopo() else {
      resultado(FlutterError(code: "sem_tela", message: "Não foi possível abrir a Carteira.", details: nil))
      return
    }
    pendente?("fechado")
    pendente = resultado
    folha.delegate = self
    tela.present(folha, animated: true)
  }

  func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
    controller.dismiss(animated: true) { [weak self] in
      self?.pendente?("fechado")
      self?.pendente = nil
    }
  }

  private static func telaDoTopo() -> UIViewController? {
    let cenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let janela = cenas.flatMap { $0.windows }.first { $0.isKeyWindow } ?? cenas.first?.windows.first
    var tela = janela?.rootViewController
    while let acima = tela?.presentedViewController {
      tela = acima
    }
    return tela
  }
}
