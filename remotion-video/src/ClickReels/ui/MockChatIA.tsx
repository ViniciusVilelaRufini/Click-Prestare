import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { APP, COLORS, EASE, SPRING } from "../theme";
import { stagger, useSpringIn } from "../lib/animation";
import { StatusBar } from "../components/Phone";
import { AppSurface, IconBadge, SuccessSeal } from "./kit";
import { Icon } from "../components/Icons";

const T = {
  greeting: 8,
  chips: 16,
  chipsOut: 36,
  userMessage: 48,
  typing: 60,
  answer: 78,
  answerEnd: 124,
  action: 128,
};

const ANSWER =
  "Feito! Reservei o Espaço Gourmet para sábado, 12/09, às 20h e liberei o acesso facial dos seus convidados.";

const SUGGESTIONS = [
  "Quais visitas estão agendadas hoje?",
  "O que foi decidido na última assembleia?",
  "Manda a 2ª via do boleto",
];

const Header: React.FC = () => {
  const enter = useSpringIn(4, SPRING.glide);

  return (
    <div
      style={{
        padding: "2px 22px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        opacity: enter,
      }}
    >
      <Icon name="sparkles" size={22} color={APP.blue} strokeWidth={2} />
      <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.4 }}>Click IA</span>
    </div>
  );
};

/** Estado vazio do chat — o mesmo do app, e evita um vazio branco na tela. */
const Greeting: React.FC = () => {
  const enter = useSpringIn(T.greeting, SPRING.glide);
  const halo = useSpringIn(T.greeting + 4, SPRING.pop);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "0 40px 24px",
        opacity: enter,
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [20, 0])}px, 0)`,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          background: `${APP.blue}14`,
          color: APP.blue,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${halo})`,
        }}
      >
        <Icon name="sparkles" size={34} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: -0.4 }}>Olá! Sou o Click IA.</div>
      <div style={{ fontSize: 12.5, color: APP.textSoft, textAlign: "center", lineHeight: 1.45 }}>
        Pergunte sobre o condomínio ou peça para eu resolver: reservar área, abrir ocorrência, pagar boleto.
      </div>
    </div>
  );
};

const Suggestions: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [T.chipsOut, T.chipsOut + 12], [0, 1], {
    easing: EASE.in,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ padding: "0 22px", opacity: 1 - out }}>
      {SUGGESTIONS.map((suggestion, index) => (
        <SuggestionChip key={suggestion} label={suggestion} delay={stagger(index, 5, T.chips)} out={out} />
      ))}
    </div>
  );
};

const SuggestionChip: React.FC<{ label: string; delay: number; out: number }> = ({
  label,
  delay,
  out,
}) => {
  const enter = useSpringIn(delay, SPRING.glide);

  return (
    <div
      style={{
        padding: "14px 16px",
        marginBottom: 10,
        borderRadius: 16,
        background: APP.surface,
        border: `1px solid ${APP.border}`,
        fontSize: 13,
        color: APP.textSoft,
        fontWeight: 600,
        opacity: enter,
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [22, 0]) - out * 14}px, 0)`,
      }}
    >
      {label}
    </div>
  );
};

const Bubble: React.FC<{
  children: React.ReactNode;
  side: "user" | "ia";
  delay: number;
}> = ({ children, side, delay }) => {
  const enter = useSpringIn(delay, SPRING.glide);
  const isUser = side === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
        opacity: Math.min(enter * 1.7, 1),
        transform: `translate3d(${interpolate(enter, [0, 1], [isUser ? 40 : -40, 0])}px, ${interpolate(
          enter,
          [0, 1],
          [16, 0],
        )}px, 0)`,
      }}
    >
      <div
        style={{
          maxWidth: 268,
          padding: "13px 16px",
          borderRadius: 20,
          borderBottomRightRadius: isUser ? 6 : 20,
          borderBottomLeftRadius: isUser ? 20 : 6,
          background: isUser ? `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})` : "#fff",
          border: isUser ? "none" : `1px solid ${APP.border}`,
          color: isUser ? "#fff" : APP.text,
          fontSize: 13.5,
          lineHeight: 1.45,
          fontWeight: 500,
          boxShadow: isUser ? `0 14px 28px -16px ${APP.blue}` : "0 12px 26px -20px rgba(12,22,51,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
};

const TypingDots: React.FC = () => {
  const frame = useCurrentFrame();
  const visible = frame >= T.typing && frame < T.answer;
  if (!visible) {
    return null;
  }

  return (
    <div style={{ display: "flex", gap: 6, padding: "14px 18px", width: 70, background: "#fff", borderRadius: 20, borderBottomLeftRadius: 6, border: `1px solid ${APP.border}`, marginBottom: 12 }}>
      {[0, 1, 2].map((index) => {
        const bounce = Math.sin((frame - T.typing) / 4 - index * 0.7);
        return (
          <div
            key={index}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: APP.textSoft,
              opacity: interpolate(bounce, [-1, 1], [0.28, 1]),
              transform: `translateY(${interpolate(bounce, [-1, 1], [2, -3])}px)`,
            }}
          />
        );
      })}
    </div>
  );
};

/** Resposta "digitando": revela por caractere, como um stream de LLM. */
const StreamingAnswer: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < T.answer) {
    return null;
  }

  const chars = Math.floor(
    interpolate(frame, [T.answer, T.answerEnd], [0, ANSWER.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const showCaret = chars < ANSWER.length && Math.floor(frame / 6) % 2 === 0;

  return (
    <Bubble side="ia" delay={T.answer}>
      {ANSWER.slice(0, chars)}
      {showCaret ? (
        <span style={{ display: "inline-block", width: 2, height: 14, background: APP.blue, marginLeft: 2, verticalAlign: "-2px" }} />
      ) : null}
    </Bubble>
  );
};

const ActionCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(T.action, SPRING.pop);
  if (frame < T.action - 4) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 20,
        background: `${APP.green}12`,
        border: `1px solid ${APP.green}33`,
        opacity: Math.min(enter * 1.6, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [24, 0])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.94, 1],
        )})`,
      }}
    >
      <SuccessSeal at={T.action + 2} size={38} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Reserva criada pela IA</div>
        <div style={{ fontSize: 11.5, color: APP.textSoft }}>Espaço Gourmet · sáb, 20h</div>
      </div>
      <IconBadge name="calendar" color={APP.green} size={34} />
    </div>
  );
};

const InputBar: React.FC = () => {
  const enter = useSpringIn(10, SPRING.glide);
  const frame = useCurrentFrame();
  const sent = frame >= T.userMessage;

  return (
    <div
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        bottom: 22,
        height: 58,
        borderRadius: 999,
        background: "#fff",
        border: `1px solid ${APP.border}`,
        boxShadow: "0 16px 34px -22px rgba(12,22,51,0.6)",
        display: "flex",
        alignItems: "center",
        padding: "0 8px 0 22px",
        gap: 10,
        opacity: enter,
      }}
    >
      <span style={{ flex: 1, fontSize: 13.5, color: sent ? APP.textSoft : APP.text, fontWeight: 500 }}>
        {sent ? "Pergunte algo ao Click IA…" : "Reserva o salão pra sábado 20h"}
      </span>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 999,
          background: `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${sent ? 1 : 1.06})`,
          boxShadow: `0 12px 24px -12px ${APP.blue}`,
        }}
      >
        <Icon name="arrow" size={19} color="#fff" strokeWidth={2.6} />
      </div>
    </div>
  );
};

export const MockChatIA: React.FC = () => (
  <AppSurface background={COLORS.white}>
    <StatusBar />
    <Header />

    <div style={{ position: "absolute", top: 104, left: 0, right: 0 }}>
      <Greeting />
      <Suggestions />
    </div>

    <div
      style={{
        position: "absolute",
        top: 404,
        left: 22,
        right: 22,
        bottom: 96,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <Bubble side="user" delay={T.userMessage}>
        Reserva o salão pra sábado às 20h
      </Bubble>
      <TypingDots />
      <StreamingAnswer />
      <ActionCard />
    </div>

    <InputBar />
  </AppSurface>
);
