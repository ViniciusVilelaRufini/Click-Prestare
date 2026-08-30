import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { COLORS, SPRING } from "../theme";
import { stagger } from "../lib/animation";

/**
 * Símbolo da Prestare (dois prédios) reconstruído em SVG:
 * o contorno é "desenhado" com stroke-dasharray e as janelas acendem
 * uma a uma — a assinatura de abertura e de fechamento do vídeo.
 */
const WINDOWS_TALL = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [2, 2],
  [0, 3],
  [2, 3],
  [0, 4],
  [2, 4],
];

const WINDOWS_SHORT = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0, 2],
  [1, 2],
];

const TALL_PATH = "M92 22h58a10 10 0 0 1 10 10v128H82V32a10 10 0 0 1 10-10z";
const SHORT_PATH = "M30 70h42a10 10 0 0 1 10 10v80H20V80a10 10 0 0 1 10-10z";

export const PrestareMark: React.FC<{
  size?: number;
  delay?: number;
  strokeColor?: string;
  windowColor?: string;
}> = ({ size = 320, delay = 0, strokeColor = COLORS.white, windowColor = COLORS.yellow }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const draw = interpolate(frame, [delay, delay + 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <svg width={size} height={size} viewBox="0 0 180 180" style={{ display: "block", overflow: "visible" }}>
      <g fill="none" stroke={strokeColor} strokeWidth={9} strokeLinejoin="round">
        <path d={TALL_PATH} strokeDasharray={420} strokeDashoffset={420 * (1 - draw)} />
        <path d={SHORT_PATH} strokeDasharray={330} strokeDashoffset={330 * (1 - Math.max(draw - 0.15, 0) / 0.85)} />
        <path
          d="M14 160h152"
          strokeLinecap="round"
          strokeDasharray={152}
          strokeDashoffset={152 * (1 - draw)}
        />
      </g>

      {WINDOWS_TALL.map(([col, row], index) => {
        const pop = spring({
          frame: frame - stagger(index, 2.2, delay + 26),
          fps,
          config: SPRING.pop,
        });
        return (
          <rect
            key={`tall-${col}-${row}`}
            x={98 + col * 18}
            y={38 + row * 22}
            width={11}
            height={11}
            rx={2}
            fill={windowColor}
            style={{
              transformOrigin: `${103.5 + col * 18}px ${43.5 + row * 22}px`,
              transform: `scale(${pop})`,
              opacity: Math.min(pop * 2, 1),
            }}
          />
        );
      })}

      {WINDOWS_SHORT.map(([col, row], index) => {
        const pop = spring({
          frame: frame - stagger(index, 2.2, delay + 34),
          fps,
          config: SPRING.pop,
        });
        return (
          <rect
            key={`short-${col}-${row}`}
            x={36 + col * 20}
            y={86 + row * 22}
            width={11}
            height={11}
            rx={2}
            fill={windowColor}
            style={{
              transformOrigin: `${41.5 + col * 20}px ${91.5 + row * 22}px`,
              transform: `scale(${pop})`,
              opacity: Math.min(pop * 2, 1),
            }}
          />
        );
      })}
    </svg>
  );
};

/** Lockup completo: símbolo + wordmark, com varredura de luz. */
export const PrestareLockup: React.FC<{
  size?: number;
  delay?: number;
  wordmark?: string;
}> = ({ size = 300, delay = 0, wordmark = "PRESTARE" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = wordmark.split("");

  const sweep = interpolate(frame, [delay + 44, delay + 92], [-40, 140], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
      <PrestareMark size={size} delay={delay} />

      <div style={{ position: "relative", display: "flex", overflow: "hidden", padding: "6px 0" }}>
        {letters.map((letter, index) => {
          const enter = spring({
            frame: frame - stagger(index, 2.5, delay + 34),
            fps,
            config: SPRING.glide,
          });
          return (
            <span
              key={`${letter}-${index}`}
              style={{
                display: "inline-block",
                fontSize: size * 0.28,
                fontWeight: 900,
                letterSpacing: size * 0.03,
                color: COLORS.yellow,
                transform: `translate3d(0, ${interpolate(enter, [0, 1], [90, 0])}px, 0)`,
                opacity: Math.min(enter * 2, 1),
              }}
            >
              {letter}
            </span>
          );
        })}

        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(100deg, rgba(255,255,255,0) 42%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 58%)",
            transform: `translateX(${sweep}%)`,
            mixBlendMode: "overlay",
          }}
        />
      </div>
    </div>
  );
};
