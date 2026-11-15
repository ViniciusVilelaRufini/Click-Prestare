import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    // Card ao vivo da portaria remota: canal com o Flutter e observação dos
    // cards abertos por push (também quando o iOS acorda o app em segundo plano).
    if let registrar = self.registrar(forPlugin: "CardAoVivoBridge") {
      CardAoVivoBridge.shared.registrar(messenger: registrar.messenger())
    } else {
      CardAoVivoBridge.shared.iniciarObservacao()
    }
    // Botão nativo "Adicionar à Carteira Apple" (PKAddPassButton) da tela Meu acesso.
    if let registrar = self.registrar(forPlugin: "BotaoCarteiraApple") {
      BotaoCarteiraAppleFabrica.registrar(com: registrar)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
