import UIKit
import Flutter
import PushKit
import CallKit
import AVFAudio
import flutter_callkit_incoming
#if canImport(WebRTC)
import WebRTC
#endif

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate, PKPushRegistryDelegate, CallkitIncomingAppDelegate {
  /// Registro do push VoIP do interfone (PushKit). Precisa viver enquanto o app vive.
  private var registroVoip: PKPushRegistry?

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

    // Interfone pelo app: token VoIP (PushKit) para o portão tocar com o app
    // fechado. Depois do registro dos plugins, para o flutter_callkit_incoming
    // já existir quando o primeiro push chegar.
    let registro = PKPushRegistry(queue: DispatchQueue.main)
    registro.delegate = self
    registro.desiredPushTypes = [PKPushType.voIP]
    registroVoip = registro

    #if canImport(WebRTC)
    // Com CallKit, quem liga o áudio é o sistema (didActivateAudioSession);
    // o WebRTC só toca/grava depois disso (orientação do flutter_callkit_incoming).
    RTCAudioSession.sharedInstance().useManualAudio = true
    RTCAudioSession.sharedInstance().isAudioEnabled = false
    #endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    // O Flutter lê com getDevicePushTokenVoIP e manda ao servidor como voip_token.
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP(token)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP("")
  }

  /// Regra da Apple: todo push VoIP vira ligação no CallKit na hora, mesmo que
  /// a chamada já tenha acabado (o Flutter confere o estado na API e encerra a
  /// tela em seguida). Sem isso o iOS mata o app e para de entregar VoIP.
  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    let bruto = payload.dictionaryPayload
    let corpo = (bruto["data"] as? [AnyHashable: Any]) ?? bruto
    func texto(_ chave: String) -> String {
      guard let valor = corpo[chave] else { return "" }
      if let s = valor as? String { return s }
      return "\(valor)"
    }
    let idTexto = texto("id")
    let portao = texto("portao")
    let unidade = texto("unidade")

    let dados = flutter_callkit_incoming.Data(
      id: AppDelegate.uuidDaChamada(Int64(idTexto) ?? 0),
      nameCaller: portao.isEmpty ? "Interfone" : portao,
      handle: unidade,
      type: 0
    )
    dados.appName = "Prestare"
    dados.duration = 60000
    dados.handleType = "generic"
    // Fora dos Recentes do app Telefone e com a unidade legível (com
    // normalHandle 0 o plugin cifra o handle).
    dados.includesCallsInRecents = false
    dados.normalHandle = 1
    dados.supportsVideo = false
    dados.supportsDTMF = false
    dados.supportsHolding = false
    dados.supportsGrouping = false
    dados.supportsUngrouping = false
    dados.maximumCallGroups = 1
    dados.maximumCallsPerCallGroup = 1
    // A chamada perdida chega pelo push comum do servidor; sem aviso duplicado.
    dados.isShowMissedCallNotification = false
    let extra: [String: String] = [
      "id": idTexto,
      "tipo": texto("tipo"),
      "unidade": unidade,
      "portao": portao,
      "condominio": texto("condominio"),
    ]
    dados.extra = extra as NSDictionary

    guard let plugin = SwiftFlutterCallkitIncomingPlugin.sharedInstance else {
      completion()
      return
    }
    plugin.showCallkitIncoming(dados, fromPushKit: true) {
      completion()
    }
  }

  /// Mesmo UUID que o Dart monta (`uuidDaChamada` em interfone_chamadas.dart):
  /// o id da chamada em hexadecimal nos 12 últimos dígitos.
  static func uuidDaChamada(_ id: Int64) -> String {
    let positivo = id < 0 ? 0 : id
    return String(format: "00000000-0000-4000-8000-%012llx", positivo)
  }

  // MARK: - CallkitIncomingAppDelegate

  func onAccept(_ call: Call, _ action: CXAnswerCallAction) {
    // O Flutter recebe ACTION_CALL_ACCEPT e entra na chamada pela API.
    action.fulfill()
  }

  func onDecline(_ call: Call, _ action: CXEndCallAction) {
    // O Flutter recebe ACTION_CALL_DECLINE e avisa a API (recusar).
    action.fulfill()
  }

  func onEnd(_ call: Call, _ action: CXEndCallAction) {
    action.fulfill()
  }

  func onTimeOut(_ call: Call) {}

  func didActivateAudioSession(_ audioSession: AVAudioSession) {
    #if canImport(WebRTC)
    RTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
    RTCAudioSession.sharedInstance().isAudioEnabled = true
    #endif
  }

  func didDeactivateAudioSession(_ audioSession: AVAudioSession) {
    #if canImport(WebRTC)
    RTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
    RTCAudioSession.sharedInstance().isAudioEnabled = false
    #endif
  }

  func providerDidReset() {}
}
