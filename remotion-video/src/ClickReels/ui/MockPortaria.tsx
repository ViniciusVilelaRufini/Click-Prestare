import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { APP, EASE, SPRING } from "../theme";
import { useSpringIn } from "../lib/animation";
import { StatusBar, ScreenTitle, TabBar } from "../components/Phone";
import { AppButton, AppCard, AppSurface, IconBadge } from "./kit";
import { Icon } from "../components/Icons";

/** Roteiro da tela, em frames relativos ao início da cena. */
const T = {
  scanEnd: 62,
  requestIn: 70,
  tap: 96,
  approved: 106,
};

const FaceScanner: React.FC = () => {
  const frame = useCurrentFrame();
  const recognized = frame >= T.scanEnd;

  // Linha de varredura em vaivém suave (seno) até reconhecer.
  const sweep = interpolate(Math.sin((frame / 26) * Math.PI * 2 - Math.PI / 2), [-1, 1], [12, 88]);
  const lock = useSpringIn(T.scanEnd, SPRING.pop);
  const accent = recognized ? APP.green : "#38E1FF";

  return (
    <div
      style={{
        position: "relative",
        height: 236,
        margin: "0 22px",
        borderRadius: 26,
        overflow: "hidden",
        background: "linear-gradient(165deg, #12203F 0%, #070C1B 100%)",
      }}
    >
      {/* Silhueta abstrata do morador */}
      <svg width="100%" height="100%" viewBox="0 0 342 236" fill="none" style={{ position: "absolute", inset: 0 }}>
        <circle cx="171" cy="96" r="42" stroke="rgba(255,255,255,0.22)" strokeWidth="2.5" />
        <path d="M104 214c0-33 30-56 67-56s67 23 67 56" stroke="rgba(255,255,255,0.16)" strokeWidth="2.5" />
        <circle cx="157" cy="92" r="3.4" fill={accent} opacity={0.85} />
        <circle cx="185" cy="92" r="3.4" fill={accent} opacity={0.85} />
        <path d="M158 110c8 6 18 6 26 0" stroke={accent} strokeWidth="2.6" strokeLinecap="round" opacity={0.85} />
      </svg>

      {/* Cantos do enquadramento */}
      {[
        { position: { top: 22, left: 26 }, angle: 0 },
        { position: { top: 22, right: 26 }, angle: 90 },
        { position: { bottom: 22, right: 26 }, angle: 180 },
        { position: { bottom: 22, left: 26 }, angle: 270 },
      ].map(({ position, angle }) => (
        <div
          key={angle}
          style={{
            position: "absolute",
            ...position,
            width: 30,
            height: 30,
            borderTop: `3px solid ${accent}`,
            borderLeft: `3px solid ${accent}`,
            borderTopLeftRadius: 10,
            transform: `rotate(${angle}deg) scale(${1 + lock * 0.12})`,
            opacity: 0.9,
          }}
        />
      ))}

      {!recognized ? (
        <div
          style={{
            position: "absolute",
            left: 26,
            right: 26,
            top: `${sweep}%`,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            boxShadow: `0 0 18px ${accent}`,
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 20,
          bottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "8px 14px",
          borderRadius: 999,
          background: recognized ? `${APP.green}E6` : "rgba(255,255,255,0.12)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <Icon name={recognized ? "check" : "face"} size={14} strokeWidth={2.8} />
        {recognized ? "Acesso liberado · Apto 101" : "Reconhecendo rosto…"}
      </div>
    </div>
  );
};

const AuthorizationCard: React.FC = () => {
  const frame = useCurrentFrame();
  const approved = frame >= T.approved;
  const collapse = interpolate(frame, [T.approved, T.approved + 14], [0, 1], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AppCard delay={T.requestIn} style={{ margin: "16px 22px 0" }} padding={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <IconBadge name="truck" color={APP.amber} size={42} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Entrega na portaria</div>
          <div style={{ fontSize: 11.5, color: APP.textSoft, marginTop: 2 }}>
            Solicita autorização · agora
          </div>
        </div>
        <div
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.4,
            background: approved ? `${APP.green}1F` : `${APP.amber}1F`,
            color: approved ? APP.green : APP.amber,
          }}
        >
          {approved ? "AUTORIZADO" : "PENDENTE"}
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 14, height: 46 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            gap: 10,
            opacity: 1 - collapse,
            transform: `translate3d(0, ${collapse * -10}px, 0)`,
          }}
        >
          <AppButton label="Negar" variant="ghost" delay={T.requestIn + 4} style={{ flex: 1 }} />
          <AppButton
            label="Autorizar"
            variant="primary"
            icon="check"
            tapAt={T.tap}
            delay={T.requestIn + 4}
            style={{ flex: 1.4 }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px",
            borderRadius: 16,
            background: `${APP.green}14`,
            color: APP.green,
            fontSize: 13,
            fontWeight: 700,
            opacity: collapse,
            transform: `translate3d(0, ${(1 - collapse) * 12}px, 0)`,
          }}
        >
          <Icon name="check" size={16} strokeWidth={3} />
          Liberado por você às 19:44
        </div>
      </div>
    </AppCard>
  );
};

export const MockPortaria: React.FC = () => (
  <AppSurface background={APP.surface}>
    <StatusBar />
    <ScreenTitle title="Portaria" />
    <FaceScanner />

    <AuthorizationCard />

    <div style={{ margin: "18px 22px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: APP.textSoft, letterSpacing: 0.6, marginBottom: 10 }}>
        ACESSOS DE HOJE
      </div>
      {[
        { name: "Maria Silva", detail: "Moradora · Apto 101", icon: "face" as const, color: APP.blue },
        { name: "Vinicius R.", detail: "Visitante · autorizado", icon: "users" as const, color: APP.green },
        { name: "Ana Prestes", detail: "Prestadora · limpeza", icon: "lock" as const, color: APP.amber },
      ].map((row, index) => (
        <AppCard key={row.name} delay={30 + index * 6} padding={12} radius={18} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <IconBadge name={row.icon} color={row.color} size={34} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{row.name}</div>
              <div style={{ fontSize: 10.5, color: APP.textSoft }}>{row.detail}</div>
            </div>
            <span style={{ fontSize: 10.5, color: APP.textSoft, fontWeight: 600 }}>
              {["19:41", "19:12", "18:03"][index]}
            </span>
          </div>
        </AppCard>
      ))}
    </div>

    <TabBar active={3} />
  </AppSurface>
);
