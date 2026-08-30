/**
 * Fonte única da verdade da montagem.
 * Mudar a ordem/duração de uma cena aqui recalcula tudo:
 * o `from` de cada Sequence, a duração total da Composition
 * e os keyframes de cor do background.
 */
import { COLORS } from "../theme";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export type SceneId =
  | "intro"
  | "problem"
  | "portaria"
  | "areas"
  | "financeiro"
  | "ia"
  | "modules"
  | "stats"
  | "outro";

export type SceneSpec = {
  id: SceneId;
  name: string;
  /** duração em frames */
  duration: number;
  /** cor de acento — pinta o glow do fundo e os detalhes da cena */
  accent: string;
};

export const SCENES: SceneSpec[] = [
  { id: "intro", name: "01 · Intro", duration: 140, accent: COLORS.yellow },
  { id: "problem", name: "02 · Problema", duration: 150, accent: COLORS.coral },
  { id: "portaria", name: "03 · Portaria", duration: 170, accent: COLORS.cyan },
  { id: "areas", name: "04 · Áreas Sociais", duration: 170, accent: COLORS.mint },
  { id: "financeiro", name: "05 · Financeiro", duration: 170, accent: COLORS.yellow },
  { id: "ia", name: "06 · Click IA", duration: 180, accent: COLORS.violet },
  { id: "modules", name: "07 · Módulos", duration: 160, accent: COLORS.brand },
  { id: "stats", name: "08 · Provas", duration: 130, accent: COLORS.cyan },
  { id: "outro", name: "09 · Outro", duration: 170, accent: COLORS.yellow },
];

export type TimelineEntry = SceneSpec & { from: number; center: number };

export const TIMELINE: TimelineEntry[] = SCENES.reduce<TimelineEntry[]>((acc, scene) => {
  const previous = acc[acc.length - 1];
  const from = previous ? previous.from + previous.duration : 0;
  acc.push({ ...scene, from, center: from + scene.duration / 2 });
  return acc;
}, []);

export const TOTAL_DURATION = TIMELINE.reduce((sum, scene) => sum + scene.duration, 0);

/** Keyframes para o `interpolateColors` do fundo (transição contínua entre acentos). */
export const ACCENT_KEYFRAMES = {
  frames: [0, ...TIMELINE.map((scene) => scene.center), TOTAL_DURATION],
  colors: [
    TIMELINE[0].accent,
    ...TIMELINE.map((scene) => scene.accent),
    TIMELINE[TIMELINE.length - 1].accent,
  ],
};

export const sceneAt = (id: SceneId): TimelineEntry => {
  const found = TIMELINE.find((scene) => scene.id === id);
  if (!found) {
    throw new Error(`Cena desconhecida: ${id}`);
  }
  return found;
};
