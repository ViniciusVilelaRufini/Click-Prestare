// Card ao vivo da portaria remota — tipo da Live Activity.
//
// Compilado no app (Runner) E na extensão (CardPortaria): o iOS casa a
// Live Activity aberta por push com o tipo pelo NOME ("CardPortariaAttributes",
// o `attributes-type` que o servidor manda).
//
// As chaves do ContentState são as do JSON `content-state` que o servidor
// monta (click-cond-web/apps/api/src/app/card-ao-vivo/conteudo.ts). Um campo
// que não decodifica faz o iOS descartar o push EM SILÊNCIO: mudar aqui exige
// mudar lá. Datas chegam como epoch em segundos (Double), não Date — o
// decoder do ActivityKit leria Date como segundos desde 2001.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct CardPortariaAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// aguardando | liberado | entrou | negado | expirado
    var fase: String
    var nome: String
    /// Visitante | Prestador
    var tipo: String
    /// "Bloco A · Apto 106"
    var unidade: String
    var chegouEm: Double
    var expiraEm: Double
    var respondidoPor: String?
    var voceRespondeu: Bool
    var pelaPortaria: Bool
    var horaResposta: Double?
    var horaEntrada: Double?
    /// Delivery: miniatura da foto do entregador (base64). Fica no estado, e
    /// não no atributo, porque a portaria pode identificá-lo depois da chegada.
    var foto: String?
    /// Delivery recusado: motivo informado pela portaria.
    var motivo: String?
  }

  /// Cards_Ao_Vivo.id no servidor (confirmação e botões).
  var idCartao: String
  /// Visitantes.id ou Visitas.id — é o id das rotas /visitantes/:id/autorizar|negar.
  var idPedido: String
  /// visitante | visita | delivery (escolhe o layout e a rota dos botões)
  var origem: String
  /// Tema escolhido no app: claro | escuro | sistema. Ausente (servidor ou
  /// app antigo) = segue o aparelho.
  var tema: String?
  /// Miniatura JPEG da foto do visitante em base64 (≤ ~2,6 KB, cabe no push
  /// de 4 KB). Ausente = card com as iniciais.
  var foto: String?
}

@available(iOS 16.1, *)
extension CardPortariaAttributes.ContentState {
  var dataChegada: Date { Date(timeIntervalSince1970: chegouEm) }
  var dataExpira: Date { Date(timeIntervalSince1970: expiraEm) }
  var dataResposta: Date? { horaResposta.map { Date(timeIntervalSince1970: $0) } }
  var dataEntrada: Date? { horaEntrada.map { Date(timeIntervalSince1970: $0) } }

  /// Mesmo estado, como resposta deste aparelho (atualização local imediata
  /// depois do botão; o push do servidor confirma em seguida).
  func respondido(fase novaFase: String) -> Self {
    var s = self
    s.fase = novaFase
    s.voceRespondeu = true
    s.pelaPortaria = false
    s.respondidoPor = nil
    s.horaResposta = Date().timeIntervalSince1970
    return s
  }
}
