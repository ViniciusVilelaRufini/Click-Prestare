# Click Reels — vídeo de apresentação do app

Vídeo programático vertical (1080×1920 · 30fps · 48s) do app **Click**, da Prestare.
Tudo é desenhado em React/SVG — nenhum screenshot, nenhuma imagem externa, nenhum
asset que possa faltar no render.

## Comandos

```bash
npm run dev                 # Remotion Studio (composição "ClickReels")
npx remotion render ClickReels out/click_reels.mp4 --codec=h264 --crf=17
npx remotion still  ClickReels out/capa.png --frame=1380   # frame de capa/thumb
```

No Studio há também uma composição por cena (`ClickReels-intro`,
`ClickReels-financeiro`, …) para iterar em 5 segundos em vez de 48.

## Estrutura

```
src/ClickReels/
├─ ClickReels.tsx        Composição principal: monta o TIMELINE em <Sequence>
├─ previews.tsx          Uma composição isolada por cena (só Studio)
├─ theme.ts              Cores, fontes, presets de mola, easings, sombras
├─ copy.ts               TODO o texto do vídeo (edite aqui para trocar campanha)
├─ index.ts
│
├─ lib/
│  ├─ timeline.ts        Ordem/duração das cenas → from, duração total, acentos
│  └─ animation.ts       Hooks de animação (useSpringIn, usePulse, useRamp…)
│
├─ components/           Peças do "palco" (fora do celular)
│  ├─ Background.tsx     Fundo persistente com aurora que muda de cor por cena
│  ├─ Scene.tsx          Casca de entrada/saída + barra de progresso
│  ├─ Type.tsx           Kicker, Headline (revelação por máscara), CountUp
│  ├─ Phone.tsx          Mockup de device, status bar, tab bar, halo
│  ├─ Glass.tsx          Cards e chips de vidro
│  ├─ PrestareMark.tsx   Logo em SVG com traço desenhado e janelas acendendo
│  └─ Icons.tsx          Set de ícones inline (stroke, 24×24)
│
├─ ui/                   O "app" fake, desenhado em pontos lógicos de iPhone
│  ├─ kit.tsx            AppCard, AppButton, Sheet, SuccessSeal, Segmented…
│  ├─ MockPortaria.tsx   Facial + autorização de visitante
│  ├─ MockAreas.tsx      Reserva de área social
│  ├─ MockFinanceiro.tsx Boleto + pagamento Pix
│  └─ MockChatIA.tsx     Click IA respondendo em streaming
│
└─ scenes/
   ├─ SceneIntro.tsx
   ├─ SceneProblem.tsx
   ├─ FeatureScene.tsx   Layout compartilhado das 4 cenas de produto
   ├─ SceneFeatures.tsx  As 4 features (wrappers finos sobre FeatureScene)
   ├─ SceneModules.tsx
   ├─ SceneStats.tsx
   └─ SceneOutro.tsx
```

## Como mexer

| Quero… | Mexo em |
| --- | --- |
| Trocar texto/claim | `copy.ts` |
| Alugar mais tempo para uma cena | `lib/timeline.ts` (o resto recalcula sozinho) |
| Mudar cor da marca | `theme.ts` → `COLORS` / `APP` |
| Mudar a "física" das animações | `theme.ts` → `SPRING` |
| Trocar a tela dentro do celular | `ui/Mock*.tsx` |
| Adicionar uma cena | criar em `scenes/`, registrar em `lib/timeline.ts` + `ClickReels.tsx` + `previews.tsx` |

## Decisões de performance

- **Sem `filter: blur()`.** Os brilhos são `radial-gradient`, que o Chrome
  rasteriza uma vez. Blur real é reprocessado a cada frame e é o maior custo
  de render em vídeos assim.
- **Sem `backdrop-filter`.** Os cards de vidro usam fill translúcido.
- **Só `transform` e `opacity`** são animados — nada de animar `width`,
  `top`, `box-shadow` ou `border-radius`, que forçam layout/paint.
- **Uma escala por device.** As telas do app são escritas em 390×844 e o
  `Phone` aplica um único `scale()`, em vez de números mágicos por cena.
- **Cenas em `<Sequence>`**: fora da janela, o React nem monta a árvore.
- **Ruído determinístico** via `random()` do Remotion — sem `Math.random()`,
  que causaria flicker entre frames e entre workers de render.

## Trilha sonora

Coloque o arquivo em `public/` e adicione em `ClickReels.tsx`:

```tsx
import { Audio, staticFile } from "remotion";
<Audio src={staticFile("trilha.mp3")} volume={0.35} />
```

Os batimentos da montagem caem em ~4,7s (intro), 9,7s (problema),
5,7s por feature e 9,3s do fim — bom ponto para alinhar os drops.
