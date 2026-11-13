// Card ao vivo da portaria remota — ponte entre o app e a Live Activity.
//
// Roda em Swift puro, sem depender do Flutter: quando o servidor abre um
// card por push-to-start com o app fechado, o iOS acorda o app em segundo
// plano para entregar o token de atualização daquele card. É aqui que ele é
// mandado ao servidor (POST /card-ao-vivo/confirmar) — a confirmação que
// evita o push comum da reserva automática.
//
// Canal "prestare/card_ao_vivo" (lib/services/card_ao_vivo/card_ao_vivo_ios.dart):
//   definirSessao(token, baseUrl) · limparSessao() · obterTokenInicio()
//   → app: tokenInicioAtualizado(token)

import ActivityKit
import Flutter
import Foundation

final class CardAoVivoBridge {
  static let shared = CardAoVivoBridge()

  private var canal: FlutterMethodChannel?
  private var observando = false
  private var cardsObservados = Set<String>()
  /// cardsObservados é tocado pela thread principal e pela Task de activityUpdates.
  private let trava = NSLock()
  private let chaveTokenInicio = "card_ao_vivo_token_inicio"

  private init() {}

  func registrar(messenger: FlutterBinaryMessenger) {
    let canal = FlutterMethodChannel(name: "prestare/card_ao_vivo", binaryMessenger: messenger)
    canal.setMethodCallHandler { [weak self] chamada, resultado in
      guard let self else { return resultado(nil) }
      switch chamada.method {
      case "definirSessao":
        let args = chamada.arguments as? [String: Any]
        if let token = args?["token"] as? String, let base = args?["baseUrl"] as? String, !token.isEmpty {
          CardSessao.salvar(token: token, baseUrl: base)
        }
        resultado(nil)
      case "limparSessao":
        CardSessao.apagar()
        self.encerrarTodos()
        resultado(nil)
      case "obterTokenInicio":
        resultado(self.tokenInicioAtual())
      default:
        resultado(FlutterMethodNotImplemented)
      }
    }
    self.canal = canal
    iniciarObservacao()
  }

  /// Token de push-to-start, ou "" quando o aparelho não pode receber card
  /// (iOS < 17.2 ou Live Activities desligadas) — o servidor então manda o
  /// push comum para este aparelho.
  private func tokenInicioAtual() -> String {
    guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return "" }
    return UserDefaults.standard.string(forKey: chaveTokenInicio) ?? ""
  }

  /// Chamado no boot do app (inclusive quando o iOS o acorda em segundo plano).
  func iniciarObservacao() {
    guard !observando else { return }
    observando = true

    if #available(iOS 17.2, *) {
      Task {
        for await dados in Activity<CardPortariaAttributes>.pushToStartTokenUpdates {
          let hex = dados.map { String(format: "%02x", $0) }.joined()
          let anterior = UserDefaults.standard.string(forKey: self.chaveTokenInicio)
          UserDefaults.standard.set(hex, forKey: self.chaveTokenInicio)
          if anterior != hex {
            await MainActor.run {
              self.canal?.invokeMethod("tokenInicioAtualizado", arguments: hex)
            }
          }
        }
      }
    }

    if #available(iOS 16.2, *) {
      for activity in Activity<CardPortariaAttributes>.activities {
        observarToken(activity)
      }
      Task {
        for await activity in Activity<CardPortariaAttributes>.activityUpdates {
          self.observarToken(activity)
        }
      }
    }
  }

  @available(iOS 16.2, *)
  private func observarToken(_ activity: Activity<CardPortariaAttributes>) {
    let id = activity.attributes.idCartao
    trava.lock()
    let novo = cardsObservados.insert(id).inserted
    trava.unlock()
    guard novo else { return }
    Task {
      for await dados in activity.pushTokenUpdates {
        let hex = dados.map { String(format: "%02x", $0) }.joined()
        let corpo: [String: Any] = ["id_cartao": Int(id) ?? 0, "token_atualizacao": hex]
        // Uma nova tentativa curta: o app pode ter sido acordado sem rede ainda.
        for tentativa in 0..<3 {
          do {
            try await CardApi.post("/card-ao-vivo/confirmar", corpo: corpo)
            break
          } catch {
            if tentativa < 2 { try? await Task.sleep(nanoseconds: 2_000_000_000) }
          }
        }
      }
    }
  }

  /// Logout: nenhum card fica na tela de quem saiu.
  private func encerrarTodos() {
    guard #available(iOS 16.2, *) else { return }
    Task {
      for activity in Activity<CardPortariaAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
