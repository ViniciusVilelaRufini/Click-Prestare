import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { COLORS, FONT, SPRING } from "../theme";
import { BRAND, OUTRO } from "../copy";
import { sceneAt } from "../lib/timeline";
import { stagger, useFloat, useSpringIn } from "../lib/animation";
import { PrestareLockup } from "../components/PrestareMark";
import { Headline } from "../components/Type";
import { Icon } from "../components/Icons";

const accent = sceneAt("outro").accent;

const StorePill: React.FC<{ label: string; index: number }> = ({ label, index }) => {
  const enter = useSpringIn(stagger(index, 6, 78), SPRING.pop);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "20px 34px",
        borderRadius: 999,
        border: `1px solid ${COLORS.line}`,
        background: "rgba(255,255,255,0.05)",
        opacity: enter,
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [30, 0])}px, 0)`,
      }}
    >
      <Icon name="download" size={22} color={accent} strokeWidth={2.4} />
      <span style={{ fontFamily: FONT.ui, fontSize: 27, fontWeight: 600, color: COLORS.mist }}>
        {label}
      </span>
    </div>
  );
};

const CtaButton: React.FC = () => {
  const enter = useSpringIn(64, SPRING.glide);
  const breathe = useFloat(4, 90);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 18,
        padding: "30px 54px",
        borderRadius: 999,
        background: `linear-gradient(140deg, ${COLORS.yellow}, #FFA800)`,
        color: "#141005",
        fontFamily: FONT.display,
        fontSize: 40,
        fontWeight: 900,
        letterSpacing: -0.5,
        boxShadow: `0 30px 60px -26px ${COLORS.yellow}`,
        opacity: enter,
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [50, breathe])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.9, 1],
        )})`,
      }}
    >
      {OUTRO.cta}
      <Icon name="arrow" size={34} strokeWidth={2.8} />
    </div>
  );
};

export const SceneOutro: React.FC = () => {
  const mark = useSpringIn(0, SPRING.glide);
  const site = useSpringIn(96, SPRING.glide);

  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 80px",
        gap: 44,
      }}
    >
      <div style={{ transform: `scale(${interpolate(mark, [0, 1], [0.85, 1])})`, opacity: mark }}>
        <PrestareLockup size={184} delay={2} />
      </div>

      <Headline
        text={OUTRO.headline}
        highlight={OUTRO.highlight}
        accent={accent}
        align="center"
        size={86}
        delay={26}
        maxWidth={860}
      />

      <CtaButton />

      <div style={{ display: "flex", gap: 18, marginTop: 6 }}>
        {OUTRO.stores.map((store, index) => (
          <StorePill key={store} label={store} index={index} />
        ))}
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 20,
          fontFamily: FONT.ui,
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: 2,
          color: COLORS.slate,
          opacity: site,
          transform: `translate3d(0, ${interpolate(site, [0, 1], [24, 0])}px, 0)`,
        }}
      >
        <span>{BRAND.site}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{BRAND.handle}</span>
      </div>
    </AbsoluteFill>
  );
};
