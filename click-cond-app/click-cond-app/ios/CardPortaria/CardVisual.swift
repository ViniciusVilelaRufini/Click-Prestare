// Card ao vivo da portaria remota — peças visuais no padrão Prestare Dark.
//
// Fonte da verdade: design system "Prestare Dark" e lib/theme/app_colors.dart
// (as duas paletas abaixo são cópias dos tokens dark*/light* de lá). Cantos
// retos em botões e tags, Barlow Condensed em maiúsculas espaçadas nos
// rótulos, Barlow no conteúdo. Amarelo da marca no que é ação e progresso
// (AUTORIZAR, barra de tempo, etapas feitas); as outras cores só sinalizam.
// Prévia aprovada: scratchpad card-preview (13/11).

import SwiftUI
import UIKit

struct Paleta {
  let superficie: Color
  let divisor: Color
  let borda: Color
  let ink: Color
  let inkMuted: Color
  let inkSubtle: Color
  let marca: Color
  let ok: Color
  let perigo: Color
  /// Fundo do botão secundário (NEGAR).
  let botaoSec: Color

  /// Texto sobre o amarelo da marca: preto nos dois temas (AppColors.onBrand).
  let sobreMarca = Color.black

  static func rgb(_ hex: UInt32) -> Color {
    Color(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }

  static let escura = Paleta(
    superficie: rgb(0x141414), divisor: rgb(0x242424), borda: rgb(0x666666),
    ink: .white, inkMuted: rgb(0xA3A3A3), inkSubtle: rgb(0x8A8A8A),
    marca: rgb(0xFFC83D), ok: rgb(0x5EC28A), perigo: rgb(0xFF6B6B),
    botaoSec: rgb(0x141414)
  )

  static let clara = Paleta(
    superficie: .white, divisor: rgb(0xE2E2E2), borda: rgb(0x888888),
    ink: .black, inkMuted: rgb(0x555555), inkSubtle: rgb(0x6B6B6B),
    marca: rgb(0xF2B10F), ok: rgb(0x1A7A48), perigo: rgb(0xC42D33),
    botaoSec: rgb(0xF4F4F4)
  )

  /// Ilha Dinâmica: sempre preta (o iOS não clareia a ilha).
  static let ilha = Paleta(
    superficie: .black, divisor: rgb(0x242424), borda: rgb(0x666666),
    ink: .white, inkMuted: rgb(0xA3A3A3), inkSubtle: rgb(0x8A8A8A),
    marca: rgb(0xFFC83D), ok: rgb(0x5EC28A), perigo: rgb(0xFF6B6B),
    botaoSec: .black
  )

  /// Tema escolhido no app; "sistema" ou ausente segue o aparelho.
  static func para(tema: String?, esquema: ColorScheme) -> Paleta {
    switch tema {
    case "claro": return .clara
    case "escuro": return .escura
    default: return esquema == .light ? .clara : .escura
    }
  }
}

private struct ChavePaleta: EnvironmentKey {
  static let defaultValue = Paleta.ilha
}

extension EnvironmentValues {
  var paleta: Paleta {
    get { self[ChavePaleta.self] }
    set { self[ChavePaleta.self] = newValue }
  }
}

enum Fonte {
  static func rotulo(_ tamanho: CGFloat) -> Font { .custom("BarlowCondensed-SemiBold", size: tamanho) }
  static func numero(_ tamanho: CGFloat) -> Font { .custom("BarlowCondensed-Light", size: tamanho) }
  static func nome(_ tamanho: CGFloat) -> Font { .custom("Barlow-Medium", size: tamanho) }
  static func texto(_ tamanho: CGFloat) -> Font { .custom("Barlow-Regular", size: tamanho) }
}

/// "14:31" no fuso do aparelho.
func horaCurta(_ data: Date?) -> String {
  guard let data else { return "" }
  let f = DateFormatter()
  f.locale = Locale(identifier: "pt_BR")
  f.dateFormat = "HH:mm"
  return f.string(from: data)
}

/// "Vinicius Vilela" → "VV"; "Ana" → "A".
func iniciais(_ nome: String) -> String {
  let partes = nome.split(whereSeparator: { $0.isWhitespace }).prefix(2)
  return partes.compactMap { $0.first.map { String($0).uppercased() } }.joined()
}

/// Rótulo técnico: Barlow Condensed 600 maiúsculo com espaçamento largo.
struct Rotulo: View {
  let texto: String
  var cor: Color? = nil
  var tamanho: CGFloat = 11
  @Environment(\.paleta) private var p

  var body: some View {
    Text(texto.uppercased())
      .font(Fonte.rotulo(tamanho))
      .tracking(tamanho * 0.2)
      .foregroundColor(cor ?? p.inkMuted)
      .lineLimit(1)
  }
}

/// Logo Prestare: dois prédios, o da frente com janelas amarelas.
struct LogoPrestare: View {
  var tamanho: CGFloat = 20
  @Environment(\.paleta) private var p

  var body: some View {
    let u = tamanho / 24
    ZStack(alignment: .topLeading) {
      Rectangle()
        .stroke(p.ink, lineWidth: 1.5 * u)
        .frame(width: 8 * u, height: 15 * u)
        .offset(x: 3 * u, y: 6 * u)
      Rectangle()
        .fill(p.superficie)
        .frame(width: 9 * u, height: 19 * u)
        .offset(x: 9 * u, y: 2 * u)
      Rectangle()
        .stroke(p.ink, lineWidth: 1.5 * u)
        .frame(width: 9 * u, height: 19 * u)
        .offset(x: 9 * u, y: 2 * u)
      ForEach(0..<3, id: \.self) { linha in
        ForEach(0..<2, id: \.self) { coluna in
          Rectangle()
            .fill(p.marca)
            .frame(width: 2 * u, height: 2 * u)
            .offset(x: (11 + CGFloat(coluna) * 3.5) * u, y: (5 + CGFloat(linha) * 4) * u)
        }
      }
    }
    .frame(width: tamanho, height: tamanho, alignment: .topLeading)
    .accessibilityLabel("Prestare")
  }
}

/// Fase → texto da tag e cor do ponto.
struct InfoFase {
  let rotulo: String
  let cor: Color

  init(_ fase: String, _ p: Paleta) {
    switch fase {
    case "aguardando": rotulo = "Aguardando"; cor = p.marca
    case "liberado": rotulo = "Liberado"; cor = p.ok
    case "entrou": rotulo = "No local"; cor = p.ok
    case "negado": rotulo = "Negado"; cor = p.perigo
    // delivery
    case "chegou", "retirar": rotulo = "Na portaria"; cor = p.marca
    case "autorizado": rotulo = "Autorizado"; cor = p.ok
    case "entregue": rotulo = "Entregue"; cor = p.ok
    case "recusado": rotulo = "Recusado"; cor = p.perigo
    default: rotulo = "Expirado"; cor = p.borda
    }
  }
}

/// Ponto de 6px de sinalização.
struct Ponto: View {
  let cor: Color
  var body: some View {
    Circle().fill(cor).frame(width: 6, height: 6)
  }
}

/// Tag de canto reto com contorno: "● AGUARDANDO".
struct TagFase: View {
  let fase: String
  @Environment(\.paleta) private var p

  var body: some View {
    let info = InfoFase(fase, p)
    HStack(spacing: 6) {
      Ponto(cor: info.cor)
      Rotulo(texto: info.rotulo, tamanho: 10)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .overlay(Rectangle().stroke(p.borda, lineWidth: 1))
  }
}

/// Miniatura JPEG em base64 que o servidor manda no push (atributo `foto`).
func imagemDaFoto(_ base64: String?) -> UIImage? {
  guard let base64, !base64.isEmpty, let dados = Data(base64Encoded: base64) else { return nil }
  return UIImage(data: dados)
}

/// Avatar: foto do visitante num círculo; sem foto, as iniciais.
struct AvatarPessoa: View {
  let nome: String
  var foto: String? = nil
  var tamanho: CGFloat = 44
  @Environment(\.paleta) private var p

  var body: some View {
    ZStack {
      let ini = iniciais(nome)
      if let imagem = imagemDaFoto(foto) {
        Image(uiImage: imagem)
          .resizable()
          .scaledToFill()
          .frame(width: tamanho, height: tamanho)
          .clipShape(Circle())
      } else if ini.isEmpty {
        Image(systemName: "person")
          .font(.system(size: tamanho * 0.36, weight: .light))
          .foregroundColor(p.ink)
      } else {
        Text(ini)
          .font(Fonte.rotulo(tamanho * 0.34))
          .tracking(tamanho * 0.03)
          .foregroundColor(p.ink)
      }
    }
    .frame(width: tamanho, height: tamanho)
    .overlay(Circle().stroke(p.borda, lineWidth: 1))
  }
}

/// Barra de tempo que esvazia junto com a contagem (o iOS anima sozinho).
struct BarraTempo: View {
  let estado: CardPortariaAttributes.ContentState
  @Environment(\.paleta) private var p

  var body: some View {
    ProgressView(
      timerInterval: estado.dataChegada...max(estado.dataChegada, estado.dataExpira),
      countsDown: true,
      label: { EmptyView() },
      currentValueLabel: { EmptyView() }
    )
    .progressViewStyle(.linear)
    .tint(p.marca)
  }
}

/// Etapas do card (nil = a fase não mostra etapas).
/// Portaria: PEDIDO → AUTORIZADO → ENTROU.
/// Delivery: CHEGOU → AUTORIZADO → ENTREGUE, ou CHEGOU → NA PORTARIA → RETIRADO.
func etapasDoCard(fase: String, delivery: Bool) -> (nomes: [String], feitas: Int)? {
  if delivery {
    switch fase {
    case "chegou": return (["Chegou", "Autorizado", "Entregue"], 1)
    case "autorizado": return (["Chegou", "Autorizado", "Entregue"], 2)
    case "retirar": return (["Chegou", "Na portaria", "Retirado"], 2)
    case "entregue": return (["Chegou", "Autorizado", "Entregue"], 3)
    default: return nil
    }
  }
  switch fase {
  case "liberado": return (["Pedido", "Autorizado", "Entrou"], 2)
  case "entrou": return (["Pedido", "Autorizado", "Entrou"], 3)
  default: return nil
  }
}

/// Três etapas com traço amarelo nas feitas.
struct Etapas: View {
  let nomes: [String]
  let feitas: Int
  @Environment(\.paleta) private var p

  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      ForEach(Array(nomes.enumerated()), id: \.offset) { i, nome in
        etapa(nome, feita: i < feitas)
      }
    }
  }

  private func etapa(_ nome: String, feita: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Rectangle().fill(feita ? p.marca : p.borda).frame(height: 2)
      Rotulo(texto: nome, cor: feita ? p.ink : p.inkSubtle, tamanho: 10)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Botões de canto reto: NEGAR contorno, AUTORIZAR amarelo da marca.
struct BotaoCard: View {
  let titulo: String
  let simbolo: String
  let solido: Bool
  @Environment(\.paleta) private var p

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: simbolo).font(.system(size: 12, weight: .regular))
      Text(titulo.uppercased()).font(Fonte.rotulo(14)).tracking(2.8)
    }
    .foregroundColor(solido ? p.sobreMarca : p.ink)
    // 36 pt: a Live Activity tem teto de altura (ver TelaBloqueio).
    .frame(maxWidth: .infinity, minHeight: 36, maxHeight: 36)
    .background(solido ? p.marca : p.botaoSec)
    .overlay(Rectangle().stroke(solido ? p.marca : p.borda, lineWidth: 1))
  }
}

/// Linha de status das fases depois da resposta (a hora fica no número à direita).
struct LinhaStatus: View {
  let estado: CardPortariaAttributes.ContentState
  var delivery = false
  @Environment(\.paleta) private var p

  var body: some View {
    if delivery {
      linhaDelivery
        .font(Fonte.texto(13))
        .foregroundColor(p.inkMuted)
        .lineLimit(2)
    } else {
      linhaPortaria
    }
  }

  @ViewBuilder private var linhaDelivery: some View {
    switch estado.fase {
    case "chegou":
      Text("Entregador chegou à portaria.")
    case "autorizado":
      Text(estado.voceRespondeu ? "Você autorizou. A caminho da sua unidade." : "Autorizado pela portaria. A caminho da sua unidade.")
    case "retirar":
      Text("Sua entrega está na portaria. Retire quando puder.")
    case "entregue":
      Text("Entregue").foregroundColor(p.ok) + Text(" às \(horaCurta(estado.dataEntrada)).")
    case "recusado":
      let motivo = (estado.motivo ?? "").trimmingCharacters(in: .whitespaces)
      if estado.voceRespondeu {
        Text("Você recusou").foregroundColor(p.perigo) + Text(" a entrega.")
      } else {
        Text("Recusado pela portaria").foregroundColor(p.perigo) + Text(motivo.isEmpty ? "." : ": \(motivo)")
      }
    default:
      Text("")
    }
  }

  private var linhaPortaria: some View {
    let quem = (estado.respondidoPor ?? "").isEmpty ? "outro morador" : (estado.respondidoPor ?? "")
    return Group {
      switch estado.fase {
      case "liberado":
        if estado.voceRespondeu {
          Text("Você autorizou. Aguardando a entrada.")
        } else if estado.pelaPortaria {
          Text("Liberado pela portaria. Aguardando a entrada.")
        } else {
          Text("Autorizado por ") + Text(quem).foregroundColor(p.ink) + Text(". Aguardando a entrada.")
        }
      case "entrou":
        Text("Entrou").foregroundColor(p.ok) + Text(" às \(horaCurta(estado.dataEntrada)).")
      case "negado":
        if estado.voceRespondeu {
          Text("Você negou").foregroundColor(p.perigo) + Text(" a entrada.")
        } else {
          Text("Negado por ").foregroundColor(p.perigo) + Text(quem).foregroundColor(p.ink) + Text(".")
        }
      case "expirado":
        Text("Sem resposta. A portaria decide a entrada.")
      default:
        Text("")
      }
    }
    .font(Fonte.texto(13))
    .foregroundColor(p.inkMuted)
    .lineLimit(2)
  }
}
