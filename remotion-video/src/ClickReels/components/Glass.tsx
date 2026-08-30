import React from "react";
import { interpolate } from "remotion";
import { COLORS, FONT, SPRING } from "../theme";
import { stagger, useSpringIn } from "../lib/animation";
import { Icon, type IconName } from "./Icons";

/**
 * Superfícies de vidro.
 * Sem `backdrop-filter`: em render de vídeo ele custa caro por frame e o
 * fundo já é um gradiente — um fill translúcido entrega o mesmo resultado.
 */
export const GlassCard: React.FC<{
  children: React.ReactNode;
  delay?: number;
  padding?: number | string;
  radius?: number;
  accent?: string;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, padding = 34, radius = 34, accent, style }) => {
  const enter = useSpringIn(delay, SPRING.glide);

  return (
    <div
      style={{
        padding,
        borderRadius: radius,
        border: `1px solid ${COLORS.line}`,
        background: accent
          ? `linear-gradient(150deg, ${accent}22 0%, rgba(255,255,255,0.04) 60%)`
          : COLORS.glass,
        opacity: Math.min(enter * 1.5, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [50, 0])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.94, 1],
        )})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Fileira de benefícios abaixo do device. */
export const BulletStrip: React.FC<{
  items: string[];
  accent: string;
  delay?: number;
}> = ({ items, accent, delay = 0 }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 16,
      padding: "0 60px",
    }}
  >
    {items.map((item, index) => (
      <Chip key={item} label={item} accent={accent} delay={stagger(index, 5, delay)} />
    ))}
  </div>
);

export const Chip: React.FC<{
  label: string;
  accent: string;
  delay?: number;
  icon?: IconName;
}> = ({ label, accent, delay = 0, icon = "check" }) => {
  const enter = useSpringIn(delay, SPRING.pop);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "15px 22px",
        borderRadius: 999,
        border: `1px solid ${COLORS.line}`,
        background: "rgba(255,255,255,0.05)",
        opacity: Math.min(enter * 1.6, 1),
        transform: `scale(${interpolate(enter, [0, 1], [0.82, 1])}) translate3d(0, ${interpolate(
          enter,
          [0, 1],
          [24, 0],
        )}px, 0)`,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background: `${accent}26`,
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={17} strokeWidth={2.6} />
      </div>
      <span
        style={{
          fontFamily: FONT.ui,
          fontWeight: 600,
          fontSize: 25,
          color: COLORS.mist,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
};
