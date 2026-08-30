/**
 * Hooks e helpers de animação.
 * Regra da casa: cena nenhuma chama `spring()` na mão — usa estes hooks,
 * para que a "física" do vídeo seja consistente do começo ao fim.
 */
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, SPRING, type SpringPreset } from "../theme";

/** Mola normalizada 0→1, com atraso em frames. */
export const useSpringIn = (delay = 0, config: SpringPreset = SPRING.silk) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return spring({
    frame: frame - delay,
    fps,
    config,
  });
};

/** Mola que sobe e volta (útil para "pulsos": check, badge, tap). */
export const usePulse = (at: number, width = 18, config: SpringPreset = SPRING.pop) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const up = spring({ frame: frame - at, fps, config });
  const down = spring({ frame: frame - at - width, fps, config });
  return up - down;
};

/** Rampa suave entre dois frames — substitui qualquer `interpolate` linear. */
export const useRamp = (from: number, to: number, easing = EASE.out) => {
  const frame = useCurrentFrame();

  return interpolate(frame, [from, to], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

/** Entrada + saída de um elemento dentro da cena. */
export const useEnterExit = ({
  enterAt = 0,
  exitAt,
  enterConfig = SPRING.glide,
  exitFrames = 12,
}: {
  enterAt?: number;
  exitAt?: number;
  enterConfig?: SpringPreset;
  exitFrames?: number;
}) => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(enterAt, enterConfig);
  const exit =
    exitAt === undefined
      ? 0
      : interpolate(frame, [exitAt, exitAt + exitFrames], [0, 1], {
          easing: EASE.in,
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  return { enter, exit, progress: enter * (1 - exit) };
};

/** Oscilação contínua para movimento ambiente (nunca deixa a tela "morta"). */
export const useFloat = (amplitude = 10, periodInFrames = 120, phase = 0) => {
  const frame = useCurrentFrame();
  return Math.sin((frame / periodInFrames) * Math.PI * 2 + phase) * amplitude;
};

/** Delay escalonado — o que dá ritmo às listas e grids. */
export const stagger = (index: number, step = 3, base = 0) => base + index * step;

/** Ruído determinístico (mesmo resultado em todo frame/worker de render). */
export const jitter = (seed: string, amplitude = 1) => (random(seed) - 0.5) * 2 * amplitude;

/** Interpola um array de valores com easing padrão da marca. */
export const rampValue = (
  frame: number,
  range: [number, number],
  values: [number, number],
  easing = EASE.out,
) =>
  interpolate(frame, range, values, {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
