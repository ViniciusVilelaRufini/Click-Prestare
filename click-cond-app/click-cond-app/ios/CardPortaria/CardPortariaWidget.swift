// Card ao vivo da portaria remota — Live Activity (tela de bloqueio e Ilha
// Dinâmica). Visual aprovado: docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota/
//
// O conteúdo vem inteiro do servidor (push-to-start / update / end). Os botões
// só existem na fase "aguardando".

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
      TelaBloqueio(attributes: context.attributes, estado: context.state)
        .activityBackgroundTint(Cores.superficie)
        .activitySystemActionForegroundColor(Cores.ink)
        .widgetURL(urlSolicitacoes)
    } dynamicIsland: { context in
      let estado = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            LogoPrestare(tamanho: 20)
            Rotulo(texto: "Prestare", cor: Cores.ink, tamanho: 12)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          NumeroDireita(estado: estado, tamanho: 26)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
              AvatarPessoa(tamanho: 40)
              VStack(alignment: .leading, spacing: 2) {
                Text(estado.nome).font(Fonte.nome(16)).foregroundColor(Cores.ink).lineLimit(1)
                Text(linhaPessoa(estado)).font(Fonte.texto(13)).foregroundColor(Cores.inkMuted).lineLimit(1)
                HStack(spacing: 6) {
                  Ponto(cor: InfoFase(estado.fase).cor)
                  Rotulo(texto: InfoFase(estado.fase).rotulo, cor: Cores.inkMuted, tamanho: 10)
                }
                .padding(.top, 2)
              }
              Spacer(minLength: 0)
            }
            if estado.fase == "aguardando" {
              Botoes(attributes: context.attributes)
            } else {
              LinhaStatus(estado: estado)
            }
          }
          .padding(.horizontal, 4)
          .padding(.bottom, 4)
        }
      } compactLeading: {
        LogoPrestare(tamanho: 18)
      } compactTrailing: {
        if estado.fase == "aguardando" {
          Text(timerInterval: estado.dataChegada...estado.dataExpira, countsDown: true)
            .font(Fonte.numero(17))
            .monospacedDigit()
            .foregroundColor(Cores.ink)
            .frame(maxWidth: 44)
        } else {
          HStack(spacing: 4) {
            Ponto(cor: InfoFase(estado.fase).cor)
            Rotulo(texto: InfoFase(estado.fase).rotulo, cor: Cores.ink, tamanho: 10)
          }
        }
      } minimal: {
        LogoPrestare(tamanho: 16)
      }
      .widgetURL(urlSolicitacoes)
      .keylineTint(Cores.marca)
    }
  }
}

/// "Visitante na portaria · Bloco A · Apto 106" (aguardando) / "Visitante · Bloco A · Apto 106".
func linhaPessoa(_ e: CardPortariaAttributes.ContentState) -> String {
  let tipo = e.fase == "aguardando" ? "\(e.tipo) na portaria" : e.tipo
  return e.unidade.isEmpty ? tipo : "\(tipo) · \(e.unidade)"
}

/// Número grande à direita: contagem (aguardando), hora da entrada, 00:00 (expirado).
struct NumeroDireita: View {
  let estado: CardPortariaAttributes.ContentState
  var tamanho: CGFloat = 34

  var body: some View {
    switch estado.fase {
    case "aguardando":
      Text(timerInterval: estado.dataChegada...estado.dataExpira, countsDown: true)
        .font(Fonte.numero(tamanho))
        .monospacedDigit()
        .foregroundColor(Cores.ink)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: tamanho * 2.4, alignment: .trailing)
    case "entrou":
      Text(horaCurta(estado.dataEntrada))
        .font(Fonte.numero(tamanho))
        .foregroundColor(Cores.ink)
    case "expirado":
      Text("00:00")
        .font(Fonte.numero(tamanho))
        .foregroundColor(Cores.inkSubtle)
    default:
      EmptyView()
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

/// Tela de bloqueio (e banner em iPhones sem Ilha Dinâmica).
struct TelaBloqueio: View {
  let attributes: CardPortariaAttributes
  let estado: CardPortariaAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 10) {
        LogoPrestare(tamanho: 22)
        Rotulo(texto: "Portaria remota", cor: Cores.inkMuted, tamanho: 12)
        Spacer(minLength: 8)
        TagFase(fase: estado.fase)
      }

      HStack(alignment: .center, spacing: 14) {
        AvatarPessoa(tamanho: 44)
        VStack(alignment: .leading, spacing: 2) {
          Text(estado.nome)
            .font(Fonte.nome(17))
            .foregroundColor(Cores.ink)
            .lineLimit(1)
          Text(linhaPessoa(estado))
            .font(Fonte.texto(13))
            .foregroundColor(Cores.inkMuted)
            .lineLimit(1)
          if estado.fase == "aguardando" {
            Text("Chegou às \(horaCurta(estado.dataChegada))")
              .font(Fonte.texto(13))
              .foregroundColor(Cores.inkMuted)
          }
        }
        Spacer(minLength: 8)
        NumeroDireita(estado: estado)
      }
      .padding(.top, 14)

      switch estado.fase {
      case "aguardando":
        Rectangle().fill(Cores.divisor).frame(height: 1).padding(.vertical, 14)
        Botoes(attributes: attributes)
      case "liberado", "entrou":
        Rectangle().fill(Cores.divisor).frame(height: 1).padding(.vertical, 14)
        Etapas(fase: estado.fase)
        LinhaStatus(estado: estado).padding(.top, 10)
      default:
        LinhaStatus(estado: estado).padding(.top, 12)
      }
    }
    .padding(16)
  }
}
