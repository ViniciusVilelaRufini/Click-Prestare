// Card ao vivo da portaria remota — botões NEGAR / AUTORIZAR e acesso à API.
//
// Compilado no app E na extensão: a extensão precisa do tipo para desenhar
// o Button(intent:), mas o iOS executa um LiveActivityIntent no PROCESSO DO
// APP (acordado em segundo plano, sem subir o Flutter). Por isso a sessão
// vem do keychain do app (CardSessao), gravada pela ponte com o Flutter.
//
// NEGAR não pede desbloqueio. AUTORIZAR exige (decisão do usuário):
// authenticationPolicy = .requiresAuthentication.

import ActivityKit
import AppIntents
import Foundation
import Security

// MARK: - Sessão (keychain)

enum CardSessao {
  private static let servico = "br.com.clickprestare.card"
  private static let conta = "sessao"

  struct Dados: Codable {
    let token: String
    let baseUrl: String
  }

  /// Acessível depois do 1º desbloqueio desde o boot: o NEGAR funciona com a
  /// tela bloqueada. Só neste aparelho (não vai para backup/iCloud).
  static func salvar(token: String, baseUrl: String) {
    guard let valor = try? JSONEncoder().encode(Dados(token: token, baseUrl: baseUrl)) else { return }
    apagar()
    let item: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servico,
      kSecAttrAccount as String: conta,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: valor,
    ]
    SecItemAdd(item as CFDictionary, nil)
  }

  static func ler() -> Dados? {
    let consulta: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servico,
      kSecAttrAccount as String: conta,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var resultado: AnyObject?
    guard SecItemCopyMatching(consulta as CFDictionary, &resultado) == errSecSuccess,
          let dados = resultado as? Data
    else { return nil }
    return try? JSONDecoder().decode(Dados.self, from: dados)
  }

  static func apagar() {
    let consulta: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servico,
      kSecAttrAccount as String: conta,
    ]
    SecItemDelete(consulta as CFDictionary)
  }
}

// MARK: - API

enum CardApi {
  enum Erro: Error {
    case semSessao
    case http(Int, String?)
  }

  /// POST na API do Prestare com a sessão do app. Devolve o status HTTP.
  @discardableResult
  static func post(_ caminho: String, corpo: [String: Any]) async throws -> Int {
    guard let sessao = CardSessao.ler(), let url = URL(string: sessao.baseUrl + caminho) else {
      throw Erro.semSessao
    }
    var req = URLRequest(url: url, timeoutInterval: 15)
    req.httpMethod = "POST"
    // Mesmo formato do app Flutter: o token vai cru no Authorization.
    req.setValue(sessao.token, forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: corpo)
    let (dados, resposta) = try await URLSession.shared.data(for: req)
    let status = (resposta as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let mensagem = (try? JSONSerialization.jsonObject(with: dados) as? [String: Any])?["message"] as? String
      throw Erro.http(status, mensagem)
    }
    return status
  }
}

// MARK: - Atualização local do card

@available(iOS 16.2, *)
enum CardLocal {
  /// Mostra a resposta na hora, sem esperar o push do servidor.
  static func responder(idCartao: String, fase: String) async {
    for activity in Activity<CardPortariaAttributes>.activities where activity.attributes.idCartao == idCartao {
      let estado = activity.content.state.respondido(fase: fase)
      let conteudo = ActivityContent(state: estado, staleDate: nil)
      if fase == "negado" {
        await activity.end(conteudo, dismissalPolicy: .after(Date().addingTimeInterval(120)))
      } else {
        await activity.update(conteudo)
      }
    }
  }
}

// MARK: - Botões

@available(iOS 17.0, *)
struct NegarCardIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Negar entrada"
  static let isDiscoverable = false

  @Parameter(title: "Cartão") var idCartao: String
  @Parameter(title: "Pedido") var idPedido: String

  init() {}

  init(idCartao: String, idPedido: String) {
    self.idCartao = idCartao
    self.idPedido = idPedido
  }

  func perform() async throws -> some IntentResult {
    try await CardApi.post("/visitantes/\(idPedido)/negar", corpo: [:])
    await CardLocal.responder(idCartao: idCartao, fase: "negado")
    return .result()
  }
}

@available(iOS 17.0, *)
struct AutorizarCardIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Autorizar entrada"
  static let isDiscoverable = false
  /// Liberar a portaria para um estranho exige o dono do aparelho.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Cartão") var idCartao: String
  @Parameter(title: "Pedido") var idPedido: String

  init() {}

  init(idCartao: String, idPedido: String) {
    self.idCartao = idCartao
    self.idPedido = idPedido
  }

  func perform() async throws -> some IntentResult {
    try await CardApi.post("/visitantes/\(idPedido)/autorizar", corpo: ["darEntrada": false])
    await CardLocal.responder(idCartao: idCartao, fase: "liberado")
    return .result()
  }
}
