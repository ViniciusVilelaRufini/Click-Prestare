import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { APP, EASE, FONT, SPRING, withAlpha } from "../theme";
import { usePulse, useSpringIn } from "../lib/animation";
import { Icon, type IconName } from "../components/Icons";

/**
 * Peças de UI do app fake, desenhadas em pontos lógicos de iPhone (390x844).
 * São compartilhadas pelas 4 telas para que o "produto" pareça o mesmo
 * em todas as cenas — que é o que vende a ideia de um app único.
 */

/** Frame "nunca": mantém hooks incondicionais sem disparar a animação. */
const NEVER = 1_000_000;

export const AppSurface: React.FC<{
  children: React.ReactNode;
  background?: string;
}> = ({ children, background = APP.bg }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background,
      fontFamily: FONT.ui,
      color: APP.text,
      position: "relative",
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

export const Segmented: React.FC<{
  options: [string, string];
  active?: 0 | 1;
  delay?: number;
}> = ({ options, active = 0, delay = 0 }) => {
  const enter = useSpringIn(delay, SPRING.glide);

  return (
    <div
      style={{
        margin: "0 22px 18px",
        padding: 5,
        borderRadius: 18,
        background: APP.surface,
        display: "flex",
        opacity: enter,
      }}
    >
      {options.map((option, index) => (
        <div
          key={option}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "11px 0",
            borderRadius: 14,
            fontSize: 13,
            fontWeight: 700,
            color: index === active ? "#fff" : APP.textSoft,
            background:
              index === active ? `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})` : "transparent",
            boxShadow: index === active ? "0 8px 18px -8px rgba(46,107,255,0.8)" : undefined,
          }}
        >
          {option}
        </div>
      ))}
    </div>
  );
};

export const AppCard: React.FC<{
  children: React.ReactNode;
  delay?: number;
  padding?: number;
  radius?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, padding = 16, radius = 22, style }) => {
  const enter = useSpringIn(delay, SPRING.glide);

  return (
    <div
      style={{
        padding,
        borderRadius: radius,
        background: "#fff",
        border: `1px solid ${APP.border}`,
        boxShadow: "0 10px 26px -18px rgba(12,22,51,0.4)",
        opacity: Math.min(enter * 1.6, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [26, 0])}px, 0)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Botão do app, com "toque" animado no frame informado. */
export const AppButton: React.FC<{
  label: string;
  tapAt?: number;
  variant?: "primary" | "ghost" | "success";
  icon?: IconName;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ label, tapAt, variant = "primary", icon, delay = 0, style }) => {
  const enter = useSpringIn(delay, SPRING.glide);
  // Hook sempre chamado (nunca condicional): sem toque, o pulso fica fora do range.
  const tap = usePulse(tapAt === undefined ? NEVER : tapAt, 6, SPRING.glide);

  const palette =
    variant === "primary"
      ? { bg: `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})`, color: "#fff", border: "transparent" }
      : variant === "success"
        ? { bg: APP.green, color: "#fff", border: "transparent" }
        : { bg: APP.surface, color: APP.textSoft, border: APP.border };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "14px 20px",
        borderRadius: 16,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontSize: 14,
        fontWeight: 700,
        overflow: "hidden",
        opacity: enter,
        transform: `scale(${1 - tap * 0.055})`,
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={16} strokeWidth={2.4} /> : null}
      {label}
      {tapAt === undefined ? null : (
        <div
          style={{
            position: "absolute",
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.45)",
            transform: `scale(${tap * 1.2})`,
            opacity: (1 - tap) * tap * 2,
          }}
        />
      )}
    </div>
  );
};

/** Bottom sheet que sobe — o gesto mais reconhecível de app mobile. */
export const Sheet: React.FC<{
  children: React.ReactNode;
  openAt: number;
  closeAt?: number;
  height?: number;
}> = ({ children, openAt, closeAt, height = 330 }) => {
  const frame = useCurrentFrame();
  const open = useSpringIn(openAt, SPRING.glide);
  const close =
    closeAt === undefined
      ? 0
      : interpolate(frame, [closeAt, closeAt + 12], [0, 1], {
          easing: EASE.in,
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const progress = open * (1 - close);

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(8,16,38,0.45)",
          opacity: progress,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height,
          padding: "14px 22px 26px",
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          background: "#fff",
          boxShadow: "0 -20px 50px -20px rgba(12,22,51,0.35)",
          transform: `translate3d(0, ${interpolate(progress, [0, 1], [height + 20, 0])}px, 0)`,
        }}
      >
        <div
          style={{
            width: 44,
            height: 5,
            borderRadius: 999,
            background: APP.border,
            margin: "0 auto 18px",
          }}
        />
        {children}
      </div>
    </>
  );
};

/** Selo de sucesso: check desenhado + anel expandindo. */
export const SuccessSeal: React.FC<{
  at: number;
  size?: number;
  color?: string;
}> = ({ at, size = 74, color = APP.green }) => {
  const frame = useCurrentFrame();
  const pop = useSpringIn(at, SPRING.pop);
  const draw = interpolate(frame, [at + 5, at + 20], [0, 1], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ring = interpolate(frame, [at, at + 30], [0, 1], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `2px solid ${color}`,
          transform: `scale(${1 + ring * 0.9})`,
          opacity: (1 - ring) * 0.7,
        }}
      />
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${pop})`,
          boxShadow: `0 16px 34px -14px ${color}`,
        }}
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4.5 12.5 5 5 10-11" strokeDasharray={26} strokeDashoffset={26 * (1 - draw)} />
        </svg>
      </div>
    </div>
  );
};

export const IconBadge: React.FC<{
  name: IconName;
  color: string;
  size?: number;
  tint?: number;
}> = ({ name, color, size = 40, tint = 0.14 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.32,
      background: withAlpha(color, tint),
      color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <Icon name={name} size={size * 0.5} strokeWidth={2.1} />
  </div>
);

export const Skeleton: React.FC<{
  width: number | string;
  height?: number;
  radius?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ width, height = 10, radius = 999, color = APP.surface, style }) => (
  <div style={{ width, height, borderRadius: radius, background: color, ...style }} />
);
