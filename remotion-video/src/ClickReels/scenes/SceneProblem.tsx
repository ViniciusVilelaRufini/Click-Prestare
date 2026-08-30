import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, EASE, FONT, SPRING } from "../theme";
import { PROBLEM } from "../copy";
import { sceneAt } from "../lib/timeline";
import { jitter, stagger, useFloat, useSpringIn } from "../lib/animation";
import { Headline, Kicker } from "../components/Type";

const accent = sceneAt("problem").accent;

const IMPLODE_AT = 104;

/**
 * Balões de "grupo do zap" entrando bagunçados e sendo sugados para o centro.
 * O caos é determinístico (`jitter` com seed) — mesmo resultado em qualquer render.
 */
const NoiseBubble: React.FC<{ text: string; index: number }> = ({ text, index }) => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(stagger(index, 7, 18), SPRING.pop);
  const float = useFloat(9, 130 + index * 11, index);

  const positions = [
    { x: -240, y: -430 },
    { x: 215, y: -270 },
    { x: -195, y: -110 },
    { x: 240, y: 50 },
    { x: -120, y: 205 },
  ];
  const base = positions[index % positions.length];
  const tilt = jitter(`tilt-${index}`, 7);

  const implode = interpolate(frame, [IMPLODE_AT, IMPLODE_AT + 18], [0, 1], {
    easing: EASE.in,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const x = base.x * (1 - implode);
  const y = (base.y + float) * (1 - implode);

  return (
    <div
      style={{
        position: "absolute",
        maxWidth: 470,
        padding: "26px 34px",
        borderRadius: 30,
        borderBottomLeftRadius: 8,
        background: "rgba(255,255,255,0.07)",
        border: `1px solid ${COLORS.line}`,
        fontFamily: FONT.ui,
        fontSize: 32,
        fontWeight: 600,
        color: COLORS.mist,
        opacity: Math.min(enter * 1.6, 1) * (1 - implode),
        transform: `translate3d(${x}px, ${y}px, 0) rotate(${tilt * (1 - implode)}deg) scale(${
          interpolate(enter, [0, 1], [0.8, 1]) * (1 - implode * 0.7)
        })`,
      }}
    >
      {text}
    </div>
  );
};

/** Flash no momento da implosão: transição de "problema" para "solução". */
const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = interpolate(frame, [IMPLODE_AT + 14, IMPLODE_AT + 20, IMPLODE_AT + 40], [0, 0.75, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 46%, ${COLORS.white} 0%, rgba(255,255,255,0) 55%)`,
        opacity: flash,
        pointerEvents: "none",
      }}
    />
  );
};

export const SceneProblem: React.FC = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {PROBLEM.noise.map((text, index) => (
        <NoiseBubble key={text} text={text} index={index} />
      ))}
    </AbsoluteFill>

    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 80px 210px",
        gap: 34,
      }}
    >
      <Kicker label={PROBLEM.kicker} accent={accent} delay={6} align="center" />
      <Headline
        text={PROBLEM.headline}
        highlight={PROBLEM.highlight}
        accent={accent}
        align="center"
        size={78}
        delay={16}
        maxWidth={900}
      />
    </AbsoluteFill>

    <Flash />
  </AbsoluteFill>
);
