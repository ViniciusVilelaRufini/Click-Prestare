import React from "react";
import { AbsoluteFill, interpolateColors, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { ACCENT_KEYFRAMES, TOTAL_DURATION } from "../lib/timeline";
import { useFloat } from "../lib/animation";

/**
 * Fundo persistente (fica FORA das Sequences).
 * É ele que dá a sensação de "um plano só": as cenas cortam por cima,
 * mas a luz do fundo apenas transiciona de cor, nunca pisca.
 *
 * Performance: os brilhos são `radial-gradient` já suaves — nada de
 * `filter: blur()`, que reblurra a cada frame e é o maior custo de render.
 */
const Aurora: React.FC<{
  color: string;
  size: number;
  x: number;
  y: number;
  opacity: number;
  drift: number;
  phase: number;
}> = ({ color, size, x, y, opacity, drift, phase }) => {
  const floatY = useFloat(drift, 420, phase);
  const floatX = useFloat(drift * 0.6, 560, phase + 1.2);

  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        left: x - size / 2,
        top: y - size / 2,
        opacity,
        background: `radial-gradient(circle at center, ${color} 0%, rgba(0,0,0,0) 68%)`,
        transform: `translate3d(${floatX}px, ${floatY}px, 0)`,
      }}
    />
  );
};

export const Background: React.FC = () => {
  const frame = useCurrentFrame();

  const accent = interpolateColors(
    frame,
    ACCENT_KEYFRAMES.frames,
    ACCENT_KEYFRAMES.colors,
  );

  // Deriva lenta da malha: dá profundidade sem chamar atenção.
  const gridShift = (frame / TOTAL_DURATION) * 120;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(170deg, ${COLORS.navy} 0%, ${COLORS.night} 45%, ${COLORS.ink} 100%)`,
        }}
      />

      <Aurora color={accent} size={1500} x={880} y={340} opacity={0.3} drift={40} phase={0} />
      <Aurora color={COLORS.brand} size={1700} x={180} y={1420} opacity={0.34} drift={55} phase={2.1} />
      <Aurora color={accent} size={1000} x={540} y={980} opacity={0.14} drift={30} phase={4} />

      {/* Malha técnica */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.line} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.line} 1px, transparent 1px)`,
          backgroundSize: "90px 90px",
          backgroundPosition: `${gridShift}px ${-gridShift}px`,
          opacity: 0.35,
          maskImage: "radial-gradient(ellipse at 50% 45%, #000 15%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, #000 15%, transparent 78%)",
        }}
      />

      {/* Vinheta: fecha as bordas e joga o olho pro centro */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(2,4,10,0.55) 78%, rgba(2,4,10,0.92) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
