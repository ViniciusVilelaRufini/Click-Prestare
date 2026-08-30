import React from "react";
import { AbsoluteFill, Sequence, interpolateColors, useCurrentFrame } from "remotion";
import { COLORS, FONT } from "./theme";
import { ACCENT_KEYFRAMES, TIMELINE, type SceneId } from "./lib/timeline";
import { Background } from "./components/Background";
import { ProgressBar, Scene } from "./components/Scene";
import { SceneIntro } from "./scenes/SceneIntro";
import { SceneProblem } from "./scenes/SceneProblem";
import { ScenePortaria, SceneAreas, SceneFinanceiro, SceneClickIA } from "./scenes/SceneFeatures";
import { SceneModules } from "./scenes/SceneModules";
import { SceneStats } from "./scenes/SceneStats";
import { SceneOutro } from "./scenes/SceneOutro";

/**
 * Composição principal.
 *
 * A montagem é dirigida pelo `TIMELINE` (lib/timeline.ts): cada cena vira
 * uma `<Sequence>` com `from` calculado. Cenas fora da janela não são
 * montadas pelo React — é isso que mantém o render leve mesmo com
 * dezenas de elementos animados por cena.
 */
const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  intro: SceneIntro,
  problem: SceneProblem,
  portaria: ScenePortaria,
  areas: SceneAreas,
  financeiro: SceneFinanceiro,
  ia: SceneClickIA,
  modules: SceneModules,
  stats: SceneStats,
  outro: SceneOutro,
};

export const ClickReels: React.FC = () => {
  const frame = useCurrentFrame();
  const accent = interpolateColors(frame, ACCENT_KEYFRAMES.frames, ACCENT_KEYFRAMES.colors);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.ink,
        fontFamily: FONT.ui,
        // Texto claro sobre fundo escuro pede antialias suave.
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <Background />

      {TIMELINE.map((scene) => {
        const Component = SCENE_COMPONENTS[scene.id];
        return (
          <Sequence
            key={scene.id}
            name={scene.name}
            from={scene.from}
            durationInFrames={scene.duration}
            layout="none"
          >
            <Scene durationInFrames={scene.duration}>
              <Component />
            </Scene>
          </Sequence>
        );
      })}

      <ProgressBar color={accent} />
    </AbsoluteFill>
  );
};
