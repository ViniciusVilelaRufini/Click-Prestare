import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, EASE, FONT, SPRING } from "../theme";
import { INTRO, BRAND } from "../copy";
import { sceneAt } from "../lib/timeline";
import { useRamp, useSpringIn } from "../lib/animation";
import { PrestareLockup } from "../components/PrestareMark";
import { Headline } from "../components/Type";

const accent = sceneAt("intro").accent;

/** Anel de "clique" que se expande no momento da marca — assinatura visual. */
const ClickRipple: React.FC<{ at: number; index: number }> = ({ at, index }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [at + index * 9, at + index * 9 + 46], [0, 1], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        width: 420,
        height: 420,
        borderRadius: "50%",
        border: `2px solid ${accent}`,
        opacity: (1 - progress) * 0.45,
        transform: `scale(${0.6 + progress * 2.4})`,
      }}
    />
  );
};

export const SceneIntro: React.FC = () => {
  const divider = useRamp(66, 90);
  const tagline = useSpringIn(96, SPRING.glide);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 90px",
        gap: 54,
      }}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {[0, 1, 2].map((index) => (
          <ClickRipple key={index} at={30} index={index} />
        ))}
        <PrestareLockup size={286} delay={4} />
      </div>

      <div
        style={{
          width: 420,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          transform: `scaleX(${divider})`,
        }}
      />

      <Headline
        text={INTRO.headline}
        highlight={INTRO.highlight}
        accent={accent}
        align="center"
        size={82}
        delay={70}
        maxWidth={860}
      />

      <div
        style={{
          fontFamily: FONT.ui,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: 7,
          textTransform: "uppercase",
          color: COLORS.slate,
          opacity: tagline,
          transform: `translate3d(0, ${interpolate(tagline, [0, 1], [26, 0])}px, 0)`,
        }}
      >
        {BRAND.company} · app {BRAND.product}
      </div>
    </AbsoluteFill>
  );
};
