import React from "react";
import { AbsoluteFill } from "remotion";
import { COLORS, FONT } from "./theme";
import { TIMELINE, type SceneId } from "./lib/timeline";
import { Background } from "./components/Background";
import { Scene } from "./components/Scene";
import { SceneIntro } from "./scenes/SceneIntro";
import { SceneProblem } from "./scenes/SceneProblem";
import { ScenePortaria, SceneAreas, SceneFinanceiro, SceneClickIA } from "./scenes/SceneFeatures";
import { SceneModules } from "./scenes/SceneModules";
import { SceneStats } from "./scenes/SceneStats";
import { SceneOutro } from "./scenes/SceneOutro";

/**
 * Composições isoladas por cena (só para o Studio).
 * Ajustar a cena do financeiro sem esperar 40s de timeline é a diferença
 * entre iterar 5 vezes e iterar 50.
 */
const COMPONENTS: Record<SceneId, React.FC> = {
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

const wrap = (id: SceneId): React.FC => {
  const Component = COMPONENTS[id];
  const duration = TIMELINE.find((scene) => scene.id === id)?.duration ?? 150;

  const Preview: React.FC = () => (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONT.ui }}>
      <Background />
      <Scene durationInFrames={duration}>
        <Component />
      </Scene>
    </AbsoluteFill>
  );

  Preview.displayName = `Preview(${id})`;
  return Preview;
};

export const SCENE_PREVIEWS = TIMELINE.reduce(
  (acc, scene) => {
    acc[scene.id] = wrap(scene.id);
    return acc;
  },
  {} as Record<SceneId, React.FC>,
);
