import React from "react";
import { interpolate } from "remotion";
import { APP, COLORS, SHADOW, SPRING } from "../theme";
import { useFloat, useSpringIn } from "../lib/animation";

/**
 * Mockup de device.
 * O conteúdo é escrito em pontos lógicos de iPhone (390x844) e a moldura
 * aplica UMA transformação de escala — assim todas as telas fake são
 * desenhadas na mesma métrica do app real, sem números mágicos por cena.
 */
export const PHONE = {
  width: 470,
  bezel: 13,
  logicalWidth: 390,
  logicalHeight: 844,
};

const SCREEN_WIDTH = PHONE.width - PHONE.bezel * 2;
export const PHONE_SCALE = SCREEN_WIDTH / PHONE.logicalWidth;
export const PHONE_HEIGHT = Math.round(PHONE.logicalHeight * PHONE_SCALE + PHONE.bezel * 2);

export const Phone: React.FC<{
  children: React.ReactNode;
  delay?: number;
  /** rotação em Y para dar perspectiva (0 = de frente) */
  tilt?: number;
  floating?: boolean;
  screenBackground?: string;
}> = ({ children, delay = 0, tilt = 0, floating = true, screenBackground = APP.bg }) => {
  const enter = useSpringIn(delay, SPRING.glide);
  const float = useFloat(floating ? 9 : 0, 180);
  const glare = useSpringIn(delay + 6, SPRING.silk);

  return (
    <div
      style={{
        width: PHONE.width,
        height: PHONE_HEIGHT,
        perspective: 2200,
        opacity: Math.min(enter * 1.6, 1),
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 62,
          padding: PHONE.bezel,
          background: "linear-gradient(160deg, #46516F 0%, #131A2E 38%, #0A0F1D 100%)",
          boxShadow: SHADOW.phone,
          transform: `translate3d(0, ${interpolate(enter, [0, 1], [140, float])}px, 0) scale(${interpolate(
            enter,
            [0, 1],
            [0.9, 1],
          )}) rotateY(${tilt}deg) rotateX(${interpolate(enter, [0, 1], [8, 0])}deg)`,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 50,
            overflow: "hidden",
            background: screenBackground,
          }}
        >
          <div
            style={{
              width: PHONE.logicalWidth,
              height: PHONE.logicalHeight,
              transform: `scale(${PHONE_SCALE})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>

          {/* Ilha dinâmica */}
          <div
            style={{
              position: "absolute",
              top: 16,
              left: "50%",
              width: 116,
              height: 34,
              marginLeft: -58,
              borderRadius: 999,
              background: "#05070E",
            }}
          />

          {/* Reflexo de vidro varrendo a tela na entrada */}
          <div
            style={{
              position: "absolute",
              inset: "-40%",
              background:
                "linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.30) 50%, rgba(255,255,255,0) 60%)",
              transform: `translateX(${interpolate(glare, [0, 1], [-90, 90])}%)`,
              opacity: 1 - glare,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** Halo atrás do device — separa o aparelho do fundo escuro. */
export const PhoneHalo: React.FC<{ color: string; delay?: number }> = ({ color, delay = 0 }) => {
  const enter = useSpringIn(delay, SPRING.silk);

  return (
    <div
      style={{
        position: "absolute",
        width: 980,
        height: 980,
        borderRadius: "50%",
        background: `radial-gradient(circle at center, ${color} 0%, rgba(0,0,0,0) 62%)`,
        opacity: enter * 0.34,
        transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})`,
      }}
    />
  );
};

/** Barra de status do iOS, desenhada (nada de screenshot). */
export const StatusBar: React.FC<{ dark?: boolean }> = ({ dark = false }) => {
  const color = dark ? "#FFFFFF" : APP.text;

  return (
    <div
      style={{
        height: 54,
        padding: "0 26px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        paddingBottom: 6,
        color,
        fontWeight: 700,
        fontSize: 15,
      }}
    >
      <span>19:44</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="18" height="12" viewBox="0 0 18 12" fill={color}>
          <rect x="0" y="8" width="3" height="4" rx="1" opacity="0.9" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" opacity="0.9" />
          <rect x="10" y="3" width="3" height="9" rx="1" opacity="0.45" />
          <rect x="15" y="0" width="3" height="12" rx="1" opacity="0.25" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
          <path d="M1 4.2a10 10 0 0 1 14 0" />
          <path d="M3.6 6.9a6.3 6.3 0 0 1 8.8 0" />
          <path d="M6.3 9.5a2.5 2.5 0 0 1 3.4 0" />
        </svg>
        <div
          style={{
            width: 24,
            height: 12,
            borderRadius: 4,
            border: `1.5px solid ${color}`,
            opacity: 0.5,
            padding: 1.5,
          }}
        >
          <div style={{ width: "62%", height: "100%", borderRadius: 2, background: color }} />
        </div>
      </div>
    </div>
  );
};

/** Tab bar flutuante do app (mesma linguagem do produto). */
export const TabBar: React.FC<{ active?: number; accent?: string }> = ({
  active = 0,
  accent = APP.blue,
}) => {
  const items = ["Início", "Encomendas", "", "Visitantes", "Financeiro"];

  return (
    <div
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 16,
        height: 68,
        borderRadius: 34,
        background: "rgba(255,255,255,0.92)",
        border: `1px solid ${APP.border}`,
        boxShadow: "0 18px 40px -18px rgba(12,22,51,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "0 8px",
      }}
    >
      {items.map((label, index) =>
        index === 2 ? (
          <div
            key="fab"
            style={{
              width: 58,
              height: 58,
              borderRadius: 999,
              marginTop: -22,
              background: `linear-gradient(160deg, ${accent}, ${APP.blueDeep})`,
              boxShadow: `0 14px 26px -10px ${accent}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M8 9h3M8 13h3M15 9h1.5M15 13h1.5" strokeLinecap="round" />
            </svg>
          </div>
        ) : (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              width: 66,
              color: index === active ? accent : APP.textSoft,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                border: `2px solid currentColor`,
                opacity: index === active ? 1 : 0.55,
              }}
            />
            <span style={{ fontSize: 10, fontWeight: 600, color: "currentColor" }}>{label}</span>
          </div>
        ),
      )}
    </div>
  );
};

export const ScreenTitle: React.FC<{ title: string; accent?: string }> = ({
  title,
  accent = COLORS.brand,
}) => (
  <div
    style={{
      padding: "4px 22px 14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          background: APP.surface,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={APP.text} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
        </svg>
      </div>
      <span style={{ fontSize: 21, fontWeight: 800, color: APP.text, letterSpacing: -0.4 }}>
        {title}
      </span>
    </div>
    <div style={{ width: 30, height: 30, borderRadius: 999, background: accent, opacity: 0.14 }} />
  </div>
);
