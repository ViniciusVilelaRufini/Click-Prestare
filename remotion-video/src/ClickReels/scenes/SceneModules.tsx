import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { COLORS, FONT, SPRING } from "../theme";
import { MODULES } from "../copy";
import { sceneAt } from "../lib/timeline";
import { stagger, useRamp, useSpringIn } from "../lib/animation";
import { Headline, Kicker } from "../components/Type";
import { Icon, type IconName } from "../components/Icons";

const accent = sceneAt("modules").accent;

const ModuleTile: React.FC<{ label: string; icon: IconName; index: number }> = ({
  label,
  icon,
  index,
}) => {
  // Stagger em diagonal: a onda atravessa o grid em vez de varrer linha a linha.
  const row = Math.floor(index / 4);
  const col = index % 4;
  const enter = useSpringIn(stagger(row + col, 3.2, 30), SPRING.glide);

  return (
    <div
      style={{
        width: 224,
        height: 196,
        padding: 24,
        borderRadius: 30,
        border: `1px solid ${COLORS.line}`,
        background: "rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity: Math.min(enter * 1.7, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [70, 0])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.82, 1],
        )})`,
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: 20,
          background: `${accent}1F`,
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={32} strokeWidth={1.9} />
      </div>
      <span
        style={{
          fontFamily: FONT.ui,
          fontSize: 25,
          fontWeight: 700,
          color: COLORS.mist,
          lineHeight: 1.2,
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const SceneModules: React.FC = () => {
  // Recuo de câmera: começa perto do grid e abre para mostrar o conjunto.
  const pullBack = useRamp(24, 120);
  const scale = interpolate(pullBack, [0, 1], [1.16, 1]);
  const lift = interpolate(pullBack, [0, 1], [70, 0]);

  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        alignItems: "center",
        padding: "110px 60px 96px",
        gap: 34,
      }}
    >
      <Kicker label={MODULES.kicker} accent={accent} delay={2} align="center" />
      <Headline
        text={MODULES.headline}
        highlight={MODULES.highlight}
        accent={accent}
        align="center"
        size={74}
        delay={8}
        maxWidth={880}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          transform: `translate3d(0, ${lift}px, 0) scale(${scale})`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 18,
            maxWidth: 980,
          }}
        >
          {MODULES.items.map((item, index) => (
            <ModuleTile key={item.label} label={item.label} icon={item.icon} index={index} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
