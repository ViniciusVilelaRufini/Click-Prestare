import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { COLORS, EASE, FONT, SPRING } from "../theme";
import { useSpringIn, stagger } from "../lib/animation";

/**
 * Tipografia animada.
 * Toda revelação de texto é por MÁSCARA (overflow hidden + translateY):
 * a palavra "sobe de dentro" da linha em vez de simplesmente aparecer.
 */

export const Kicker: React.FC<{
  label: string;
  accent?: string;
  delay?: number;
  align?: "left" | "center";
}> = ({ label, accent = COLORS.cyan, delay = 0, align = "left" }) => {
  const enter = useSpringIn(delay, SPRING.glide);
  const dot = useSpringIn(delay + 6, SPRING.pop);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: align === "center" ? "center" : "flex-start",
        opacity: enter,
        transform: `translate3d(${interpolate(enter, [0, 1], [-40, 0])}px, 0, 0)`,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 28px 14px 22px",
          borderRadius: 999,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.glass,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: accent,
            transform: `scale(${dot})`,
            boxShadow: `0 0 22px ${accent}`,
          }}
        />
        <span
          style={{
            fontFamily: FONT.ui,
            fontWeight: 600,
            fontSize: 27,
            letterSpacing: 3.4,
            textTransform: "uppercase",
            color: COLORS.mist,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
};

export const Headline: React.FC<{
  text: string;
  highlight?: string[];
  accent?: string;
  size?: number;
  delay?: number;
  step?: number;
  align?: "left" | "center";
  color?: string;
  maxWidth?: number;
}> = ({
  text,
  highlight = [],
  accent = COLORS.cyan,
  size = 92,
  delay = 0,
  step = 3,
  align = "left",
  color = COLORS.white,
  maxWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        columnGap: size * 0.24,
        rowGap: 0,
        maxWidth,
        fontFamily: FONT.display,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: -size * 0.032,
      }}
    >
      {words.map((word, index) => {
        const wordDelay = stagger(index, step, delay);
        const enter = spring({
          frame: frame - wordDelay,
          fps,
          config: SPRING.glide,
        });
        const isAccent = highlight.indexOf(word) >= 0;
        const underline = interpolate(
          frame,
          [wordDelay + 8, wordDelay + 26],
          [0, 1],
          { easing: EASE.out, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );

        return (
          <span
            key={`${word}-${index}`}
            style={{
              display: "block",
              overflow: "hidden",
              paddingBottom: size * 0.14,
              marginBottom: -size * 0.05,
            }}
          >
            <span
              style={{
                display: "inline-block",
                position: "relative",
                color: isAccent ? accent : color,
                transform: `translate3d(0, ${interpolate(enter, [0, 1], [size * 1.15, 0])}px, 0)`,
                opacity: Math.min(enter * 2, 1),
              }}
            >
              {word}
              {isAccent ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: size * 0.02,
                    height: size * 0.075,
                    borderRadius: 999,
                    background: accent,
                    opacity: 0.32,
                    transform: `scaleX(${underline})`,
                    transformOrigin: "left center",
                  }}
                />
              ) : null}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export const Paragraph: React.FC<{
  text: string;
  delay?: number;
  size?: number;
  align?: "left" | "center";
  maxWidth?: number;
  color?: string;
}> = ({ text, delay = 0, size = 34, align = "left", maxWidth = 800, color = COLORS.slate }) => {
  const enter = useSpringIn(delay, SPRING.silk);

  return (
    <p
      style={{
        margin: 0,
        maxWidth,
        fontFamily: FONT.ui,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.45,
        color,
        textAlign: align,
        alignSelf: align === "center" ? "center" : "flex-start",
        opacity: enter,
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [28, 0])}px, 0)`,
      }}
    >
      {text}
    </p>
  );
};

/** Números que sobem — usado nas provas e no valor do boleto. */
export const CountUp: React.FC<{
  to: number;
  from?: number;
  delay?: number;
  durationInFrames?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({
  to,
  from = 0,
  delay = 0,
  durationInFrames = 40,
  decimals = 0,
  prefix = "",
  suffix = "",
  style,
}) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [delay, delay + durationInFrames], [from, to], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
