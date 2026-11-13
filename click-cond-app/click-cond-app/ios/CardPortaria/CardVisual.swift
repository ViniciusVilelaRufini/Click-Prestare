// Card ao vivo da portaria remota — peças visuais no padrão Prestare Dark.
//
// Fonte da verdade: design system "Prestare Dark" e lib/theme/app_colors.dart.
// Fundo preto, superfície #141414, CANTOS RETOS em botões e tags, Barlow
// Condensed em maiúsculas espaçadas nos rótulos, Barlow no conteúdo. Cor só
// sinaliza: ponto de 6px e texto curto. Nada de ilustração ou ícone colorido.

import SwiftUI

enum Cores {
  static let fundo = Color(red: 0, green: 0, blue: 0)
  static let superficie = Color(red: 0x14 / 255, green: 0x14 / 255, blue: 0x14 / 255)
  static let divisor = Color(red: 0x24 / 255, green: 0x24 / 255, blue: 0x24 / 255)
  static let borda = Color(red: 0x66 / 255, green: 0x66 / 255, blue: 0x66 / 255)
  static let ink = Color.white
  static let inkMuted = Color(red: 0xA3 / 255, green: 0xA3 / 255, blue: 0xA3 / 255)
  static let inkSubtle = Color(red: 0x8A / 255, green: 0x8A / 255, blue: 0x8A / 255)
  static let marca = Color(red: 0xFF / 255, green: 0xC8 / 255, blue: 0x3D / 255)
  static let ok = Color(red: 0x5E / 255, green: 0xC2 / 255, blue: 0x8A / 255)
  static let perigo = Color(red: 0xFF / 255, green: 0x6B / 255, blue: 0x6B / 255)
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

/// Rótulo técnico: Barlow Condensed 600 maiúsculo com espaçamento largo.
struct Rotulo: View {
  let texto: String
  var cor: Color = Cores.inkMuted
  var tamanho: CGFloat = 11

  var body: some View {
    Text(texto.uppercased())
      .font(Fonte.rotulo(tamanho))
      .tracking(tamanho * 0.2)
      .foregroundColor(cor)
      .lineLimit(1)
  }
}

/// Logo Prestare: dois prédios, o da frente com janelas amarelas.
struct LogoPrestare: View {
  var tamanho: CGFloat = 20

  var body: some View {
    let u = tamanho / 24
    ZStack(alignment: .topLeading) {
      Rectangle()
        .stroke(Cores.ink, lineWidth: 1.5 * u)
        .frame(width: 8 * u, height: 15 * u)
        .offset(x: 3 * u, y: 6 * u)
      Rectangle()
        .fill(Cores.fundo)
        .frame(width: 9 * u, height: 19 * u)
        .offset(x: 9 * u, y: 2 * u)
      Rectangle()
        .stroke(Cores.ink, lineWidth: 1.5 * u)
        .frame(width: 9 * u, height: 19 * u)
        .offset(x: 9 * u, y: 2 * u)
      ForEach(0..<3, id: \.self) { linha in
        ForEach(0..<2, id: \.self) { coluna in
          Rectangle()
            .fill(Cores.marca)
            .frame(width: 2 * u, height: 2 * u)
            .offset(x: (11 + CGFloat(coluna) * 3.5) * u, y: (5 + CGFloat(linha) * 4) * u)
        }
      }
    }
    .frame(width: tamanho, height: tamanho, alignment: .topLeading)
    .accessibilityLabel("Prestare")
  }
}

/// Fase → texto e cor da tag.
struct InfoFase {
  let rotulo: String
  let cor: Color

  init(_ fase: String) {
    switch fase {
    case "aguardando": rotulo = "Aguardando"; cor = Cores.marca
    case "liberado": rotulo = "Liberado"; cor = Cores.ok
    case "entrou": rotulo = "No local"; cor = Cores.ok
    case "negado": rotulo = "Negado"; cor = Cores.perigo
    default: rotulo = "Expirado"; cor = Cores.borda
    }
  }
}

/// Ponto de 6px — a única cor do card.
struct Ponto: View {
  let cor: Color
  var body: some View {
    Circle().fill(cor).frame(width: 6, height: 6)
  }
}

/// Tag de canto reto com contorno #666: "● AGUARDANDO".
struct TagFase: View {
  let fase: String
  var body: some View {
    let info = InfoFase(fase)
    HStack(spacing: 6) {
      Ponto(cor: info.cor)
      Rotulo(texto: info.rotulo, cor: Cores.inkMuted, tamanho: 10)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .overlay(Rectangle().stroke(Cores.borda, lineWidth: 1))
  }
}

/// Avatar: círculo com contorno e ícone de pessoa de traço fino.
struct AvatarPessoa: View {
  var tamanho: CGFloat = 44
  var body: some View {
    ZStack {
      Circle().stroke(Cores.borda, lineWidth: 1)
      Image(systemName: "person")
        .font(.system(size: tamanho * 0.36, weight: .light))
        .foregroundColor(Cores.ink)
    }
    .frame(width: tamanho, height: tamanho)
  }
}

/// PEDIDO → AUTORIZADO → ENTROU.
struct Etapas: View {
  let fase: String

  var body: some View {
    let feitas = fase == "entrou" ? 3 : 2
    HStack(alignment: .top, spacing: 6) {
      etapa("Pedido", feita: feitas >= 1)
      etapa("Autorizado", feita: feitas >= 2)
      etapa("Entrou", feita: feitas >= 3)
    }
  }

  private func etapa(_ nome: String, feita: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Rectangle().fill(feita ? Cores.ink : Cores.borda).frame(height: 2)
      Rotulo(texto: nome, cor: feita ? Cores.ink : Cores.inkSubtle, tamanho: 10)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Botões de canto reto: NEGAR contorno, AUTORIZAR sólido branco.
struct BotaoCard: View {
  let titulo: String
  let simbolo: String
  let solido: Bool

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: simbolo).font(.system(size: 12, weight: .regular))
      Text(titulo.uppercased()).font(Fonte.rotulo(14)).tracking(2.8)
    }
    .foregroundColor(solido ? Cores.fundo : Cores.ink)
    .frame(maxWidth: .infinity, minHeight: 40)
    .background(solido ? Cores.ink : Cores.superficie)
    .overlay(Rectangle().stroke(solido ? Cores.ink : Cores.borda, lineWidth: 1))
  }
}

/// Linha de status das fases depois da resposta.
struct LinhaStatus: View {
  let estado: CardPortariaAttributes.ContentState

  var body: some View {
    let hora = horaCurta(estado.dataResposta)
    let quem = (estado.respondidoPor ?? "").isEmpty ? "outro morador" : (estado.respondidoPor ?? "")
    Group {
      switch estado.fase {
      case "liberado":
        if estado.voceRespondeu {
          Text("Você autorizou às \(hora). Aguardando a entrada.")
        } else if estado.pelaPortaria {
          Text("Liberado pela portaria às \(hora). Aguardando a entrada.")
        } else {
          Text("Autorizado por ") + Text(quem).foregroundColor(Cores.ink) + Text(" às \(hora). Aguardando a entrada.")
        }
      case "entrou":
        Text("Entrou").foregroundColor(Cores.ok) + Text(" · \(estado.tipo)")
      case "negado":
        if estado.voceRespondeu {
          Text("Você negou").foregroundColor(Cores.perigo) + Text(" a entrada às \(hora).")
        } else {
          Text("Negado por ").foregroundColor(Cores.perigo) + Text(quem).foregroundColor(Cores.ink) + Text(" às \(hora).")
        }
      case "expirado":
        Text("Sem resposta. A portaria decide a entrada.")
      default:
        Text("")
      }
    }
    .font(Fonte.texto(13))
    .foregroundColor(Cores.inkMuted)
    .lineLimit(2)
  }
}
