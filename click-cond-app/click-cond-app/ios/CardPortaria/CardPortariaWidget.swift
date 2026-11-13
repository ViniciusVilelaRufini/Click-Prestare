// Card ao vivo da portaria remota — Live Activity (tela de bloqueio e Ilha
// Dinâmica). Visual aprovado: docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota/
// e a prévia de 13/11 (iniciais, rótulo sob o número, barra de tempo e
// AUTORIZAR em amarelo, tema claro).
//
// O conteúdo vem inteiro do servidor (push-to-start / update / end). Os botões
// só existem na fase "aguardando". A tela de bloqueio segue o tema escolhido
// no app (atributo `tema`); a Ilha Dinâmica é sempre preta.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct CardPortariaBundle: WidgetBundle {
  var body: some Widget {
    CardPortariaLiveActivity()
  }
}

private let urlSolicitacoes = URL(string: "clickprestare://solicitacoes")

struct CardPortariaLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CardPortariaAttributes.self) { context in
      CardTelaBloqueio(
        attributes: context.attributes,
        estado: estadoVisivel(context.state, vencido: context.isStale)
      )
      .widgetURL(urlSolicitacoes)
    } dynamicIsland: { context in
      let estado = estadoVisivel(context.state, vencido: context.isStale)
      // A ilha expandida tem teto de altura (~160 pt no total): pessoa nas
      // regiões de cima (iniciais | nome | contagem) para sobrar espaço
      // embaixo para a barra e os botões.
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          AvatarPessoa(nome: estado.nome, tamanho: 36)
            .padding(.leading, 4)
            .environment(\.paleta, .ilha)
        }
        DynamicIslandExpandedRegion(.trailing) {
          NumeroDireita(estado: estado, tamanho: 24, comRotulo: false)
            .padding(.trailing, 4)
            .environment(\.paleta, .ilha)
        }
        DynamicIslandExpandedRegion(.center) {
          IlhaNome(estado: estado)
            .environment(\.paleta, .ilha)
        }
        DynamicIslandExpandedRegion(.bottom) {
          IlhaExpandida(attributes: context.attributes, estado: estado)
            .environment(\.paleta, .ilha)
        }
      } compactLeading: {
        LogoPrestare(tamanho: 18)
          .environment(\.paleta, .ilha)
      } compactTrailing: {
        CompactoDireita(estado: estado)
          .environment(\.paleta, .ilha)
      } minimal: {
        LogoPrestare(tamanho: 16)
          .environment(\.paleta, .ilha)
      }
      .widgetURL(urlSolicitacoes)
      .keylineTint(Paleta.ilha.marca)
    }
  }
}

/// Card AGUARDANDO que passou do prazo (o iOS marca como "stale" pelo
/// stale-date do push) aparece como EXPIRADO mesmo se o push do servidor não
/// chegar — app fechado à força, sem rede.
func estadoVisivel(_ e: CardPortariaAttributes.ContentState, vencido: Bool) -> CardPortariaAttributes.ContentState {
  guard vencido, e.fase == "aguardando" else { return e }
  var s = e
  s.fase = "expirado"
  return s
}

/// "Visitante · Bloco A · Apto 106".
func linhaPessoa(_ e: CardPortariaAttributes.ContentState) -> String {
  e.unidade.isEmpty ? e.tipo : "\(e.tipo) · \(e.unidade)"
}

/// Número grande à direita com o rótulo embaixo: contagem (aguardando), hora
/// da resposta (liberado/negado), hora da entrada, 0:00 (expirado).
struct NumeroDireita: View {
  let estado: CardPortariaAttributes.ContentState
  var tamanho: CGFloat = 36
  var comRotulo = true
  @Environment(\.paleta) private var p

  var body: some View {
    VStack(alignment: .trailing, spacing: 2) {
      numero
      if comRotulo, let r = rotulo {
        Rotulo(texto: r, tamanho: 9)
      }
    }
  }

  private var rotulo: String? {
    switch estado.fase {
    case "aguardando": return "Para responder"
    case "liberado": return "Autorizado"
    case "entrou": return "Entrou"
    case "negado": return "Negado"
    case "expirado": return "Sem resposta"
    default: return nil
    }
  }

  @ViewBuilder private var numero: some View {
    switch estado.fase {
    case "aguardando":
      Text(timerInterval: estado.dataChegada...max(estado.dataChegada, estado.dataExpira), countsDown: true)
        .font(Fonte.numero(tamanho))
        .monospacedDigit()
        .foregroundColor(p.ink)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: tamanho * 2.4, alignment: .trailing)
    case "liberado", "negado":
      Text(horaCurta(estado.dataResposta))
        .font(Fonte.numero(tamanho))
        .foregroundColor(p.ink)
    case "entrou":
      Text(horaCurta(estado.dataEntrada))
        .font(Fonte.numero(tamanho))
        .foregroundColor(p.ink)
    case "expirado":
      Text("0:00")
        .font(Fonte.numero(tamanho))
        .foregroundColor(p.inkSubtle)
    default:
      EmptyView()
    }
  }
}

/// Ilha compacta, à direita: a contagem ou a fase.
struct CompactoDireita: View {
  let estado: CardPortariaAttributes.ContentState
  @Environment(\.paleta) private var p

  var body: some View {
    if estado.fase == "aguardando" {
      Text(timerInterval: estado.dataChegada...max(estado.dataChegada, estado.dataExpira), countsDown: true)
        .font(Fonte.numero(17))
        .monospacedDigit()
        .foregroundColor(p.ink)
        .frame(maxWidth: 44)
    } else {
      HStack(spacing: 4) {
        Ponto(cor: InfoFase(estado.fase, p).cor)
        Rotulo(texto: InfoFase(estado.fase, p).rotulo, cor: p.ink, tamanho: 10)
      }
    }
  }
}

struct Botoes: View {
  let attributes: CardPortariaAttributes

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: NegarCardIntent(idCartao: attributes.idCartao, idPedido: attributes.idPedido)) {
        BotaoCard(titulo: "Negar", simbolo: "xmark", solido: false)
      }
      .buttonStyle(.plain)
      Button(intent: AutorizarCardIntent(idCartao: attributes.idCartao, idPedido: attributes.idPedido)) {
        BotaoCard(titulo: "Autorizar", simbolo: "checkmark", solido: true)
      }
      .buttonStyle(.plain)
    }
  }
}

/// Nome e "Visitante · Bloco A · Apto 106".
struct NomeEUnidade: View {
  let estado: CardPortariaAttributes.ContentState
  var tamanhoNome: CGFloat = 16
  var tamanhoLinha: CGFloat = 13
  @Environment(\.paleta) private var p

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(estado.nome)
        .font(Fonte.nome(tamanhoNome))
        .foregroundColor(p.ink)
        .lineLimit(1)
      Text(linhaPessoa(estado))
        .font(Fonte.texto(tamanhoLinha))
        .foregroundColor(p.inkMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }
  }
}

/// Pessoa: iniciais, nome, tipo e unidade.
struct LinhaVisitante: View {
  let estado: CardPortariaAttributes.ContentState
  var avatar: CGFloat = 38

  var body: some View {
    HStack(spacing: 12) {
      AvatarPessoa(nome: estado.nome, tamanho: avatar)
      NomeEUnidade(estado: estado)
      Spacer(minLength: 0)
    }
  }
}

/// Tela de bloqueio na paleta do tema do app.
struct CardTelaBloqueio: View {
  let attributes: CardPortariaAttributes
  let estado: CardPortariaAttributes.ContentState
  @Environment(\.colorScheme) private var esquema

  var body: some View {
    let p = Paleta.para(tema: attributes.tema, esquema: esquema)
    TelaBloqueio(attributes: attributes, estado: estado)
      .environment(\.paleta, p)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      // Fundo desenhado aqui (e não só pelo tint), para o tema do app valer
      // mesmo quando o aparelho está no tema oposto.
      .background(p.superficie)
      .activityBackgroundTint(p.superficie)
      .activitySystemActionForegroundColor(p.ink)
  }
}

/// Tela de bloqueio (e banner em iPhones sem Ilha Dinâmica).
///
/// O iOS dá no máximo ~160 pt de altura à Live Activity e CORTA o que passar
/// (o 1.2.43 perdeu o topo e os botões). Orçamento da fase mais alta
/// (aguardando): 12 + cabeçalho 18 + 10 + pessoa 42 + 10 + barra 4 + 10 +
/// botões 36 + 12 = 154 pt. Mexeu em tamanho ou espaço, refaça a conta.
struct TelaBloqueio: View {
  let attributes: CardPortariaAttributes
  let estado: CardPortariaAttributes.ContentState
  @Environment(\.paleta) private var p

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        LogoPrestare(tamanho: 18)
        Rotulo(texto: "Portaria remota", tamanho: 11)
        Spacer(minLength: 8)
        TagFase(fase: estado.fase)
      }
      .frame(height: 18)

      HStack(alignment: .center, spacing: 8) {
        LinhaVisitante(estado: estado)
        NumeroDireita(estado: estado, tamanho: 30)
      }
      .padding(.top, 10)

      switch estado.fase {
      case "aguardando":
        BarraTempo(estado: estado).padding(.top, 10)
        Botoes(attributes: attributes).padding(.top, 10)
      case "liberado", "entrou":
        Rectangle().fill(p.divisor).frame(height: 1).padding(.vertical, 8)
        Etapas(fase: estado.fase)
        LinhaStatus(estado: estado).padding(.top, 6)
      default:
        LinhaStatus(estado: estado).padding(.top, 8)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

/// Ilha Dinâmica expandida, centro: nome e unidade.
struct IlhaNome: View {
  let estado: CardPortariaAttributes.ContentState

  var body: some View {
    NomeEUnidade(estado: estado, tamanhoNome: 15, tamanhoLinha: 12)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Ilha Dinâmica expandida, parte de baixo: barra e botões (ou a fase).
struct IlhaExpandida: View {
  let attributes: CardPortariaAttributes
  let estado: CardPortariaAttributes.ContentState
  @Environment(\.paleta) private var p

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if estado.fase == "aguardando" {
        BarraTempo(estado: estado)
        Botoes(attributes: attributes)
      } else {
        HStack(spacing: 6) {
          Ponto(cor: InfoFase(estado.fase, p).cor)
          Rotulo(texto: InfoFase(estado.fase, p).rotulo, tamanho: 10)
        }
        LinhaStatus(estado: estado)
      }
    }
    .padding(.horizontal, 4)
    .padding(.bottom, 4)
  }
}
