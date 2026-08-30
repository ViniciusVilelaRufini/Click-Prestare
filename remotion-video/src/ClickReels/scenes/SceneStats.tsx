import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { COLORS, FONT, SPRING } from "../theme";
import { STATS } from "../copy";
import { sceneAt } from "../lib/timeline";
import { stagger, useSpringIn } from "../lib/animation";
import { CountUp, Headline, Kicker } from "../components/Type";

const accent = sceneAt("stats").accent;

const ACCENT_BY_KEY: Record<string, string> = {
  cyan: COLORS.cyan,
  yellow: COLORS.yellow,
  mint: COLORS.mint,
};

const StatCard: React.FC<{
  value: number;
  suffix: string;
  label: string;
  color: string;
  index: number;
}> = ({ value, suffix, label, color, index }) => {
  const delay = stagger(index, 12, 16);
  const enter = useSpringIn(delay, SPRING.glide);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "38px 44px",
        borderRadius: 38,
        border: `1px solid ${COLORS.line}`,
        background: `linear-gradient(120deg, ${color}1A 0%, rgba(255,255,255,0.03) 55%)`,
        opacity: Math.min(enter * 1.6, 1),
        transform: `translate3d(${interpolate(enter, [0, 1], [index % 2 === 0 ? -70 : 70, 0])}px, 0, 0)`,
      }}
    >
      <div
        style={{
          minWidth: 210,
          fontFamily: FONT.display,
          fontSize: 104,
          fontWeight: 900,
          letterSpacing: -4,
          color,
          lineHeight: 1,
        }}
      >
        <CountUp to={value} delay={delay + 4} durationInFrames={34} suffix={suffix} />
      </div>
      <div
        style={{
          fontFamily: FONT.ui,
          fontSize: 32,
          fontWeight: 600,
          color: COLORS.mist,
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const SceneStats: React.FC = () => (
  <AbsoluteFill
    style={{
      flexDirection: "column",
      justifyContent: "center",
      padding: "0 70px",
      gap: 30,
    }}
  >
    <Kicker label={STATS.kicker} accent={accent} delay={0} />
    <Headline
      text={STATS.headline}
      highlight={STATS.highlight}
      accent={accent}
      size={76}
      delay={6}
      maxWidth={880}
    />

    <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 26 }}>
      {STATS.items.map((item, index) => (
        <StatCard
          key={item.label}
          value={item.value}
          suffix={item.suffix}
          label={item.label}
          color={ACCENT_BY_KEY[item.accentKey] ?? accent}
          index={index}
        />
      ))}
    </div>
  </AbsoluteFill>
);
