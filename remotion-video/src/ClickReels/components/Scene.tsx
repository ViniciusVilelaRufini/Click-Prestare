import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, SPRING } from "../theme";
import { useSpringIn } from "../lib/animation";

/**
 * Casca de cena: padroniza entrada e saída de TODAS as cenas.
 * Entrada com mola (escala + subida), saída com easing de aceleração —
 * é o que faz o corte parecer movimento de câmera e não troca de slide.
 */
export const Scene: React.FC<{
  durationInFrames: number;
  children: React.ReactNode;
  /** frames de saída antes do fim da cena */
  exitFrames?: number;
  /** desliga a animação da casca quando a cena controla o próprio corte */
  bare?: boolean;
}> = ({ durationInFrames, children, exitFrames = 14, bare = false }) => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(0, SPRING.silk);

  const exitStart = durationInFrames - exitFrames;
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    easing: EASE.in,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (bare) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const scale = interpolate(enter, [0, 1], [1.07, 1]) - exit * 0.05;
  const translateY = interpolate(enter, [0, 1], [70, 0]) - exit * 60;
  const opacity = Math.min(enter * 1.4, 1) * (1 - exit);

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/**
 * Barra de progresso do Reels — detalhe pequeno que faz o vídeo
 * "prender": o espectador vê que falta pouco.
 */
export const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: 54,
        height: 5,
        borderRadius: 999,
        background: "rgba(255,255,255,0.10)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${color}, #FFFFFF)`,
          transform: `scaleX(${progress})`,
          transformOrigin: "left center",
        }}
      />
    </div>
  );
};
