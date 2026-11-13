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
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
