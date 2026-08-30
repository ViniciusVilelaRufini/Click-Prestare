import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { APP, SPRING } from "../theme";
import { stagger, useSpringIn } from "../lib/animation";
import { StatusBar, ScreenTitle, TabBar } from "../components/Phone";
import { AppButton, AppSurface, Segmented, Sheet, SuccessSeal } from "./kit";
import { Icon, type IconName } from "../components/Icons";

const T = {
  cards: 22,
  tapReservar: 62,
  sheet: 70,
  confirm: 106,
  success: 116,
};

type Area = {
  name: string;
  icon: IconName;
  from: string;
  to: string;
  status: string;
};

const AREAS: Area[] = [
  { name: "Espaço Gourmet", icon: "users", from: "#2E6BFF", to: "#123ABE", status: "Livre sábado" },
  { name: "Sala de Jogos", icon: "sparkles", from: "#7C5CFF", to: "#3A1FA8", status: "Livre hoje" },
  { name: "Sauna Seca", icon: "clock", from: "#00A5EC", to: "#0B5D9E", status: "Manutenção 6ª" },
];

const AreaCard: React.FC<{ area: Area; index: number; withTap?: boolean }> = ({
  area,
  index,
  withTap = false,
}) => {
  const enter = useSpringIn(stagger(index, 7, T.cards), SPRING.glide);

  return (
    <div
      style={{
        margin: "0 22px 14px",
        borderRadius: 24,
        overflow: "hidden",
        background: "#fff",
        border: `1px solid ${APP.border}`,
        boxShadow: "0 14px 30px -22px rgba(12,22,51,0.5)",
        opacity: Math.min(enter * 1.6, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [46, 0])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.95, 1],
        )})`,
      }}
    >
      <div
        style={{
          position: "relative",
          height: 108,
          background: `linear-gradient(150deg, ${area.from}, ${area.to})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <div style={{ opacity: 0.5 }}>
          <Icon name={area.icon} size={46} strokeWidth={1.6} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 14,
            top: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 11px",
            borderRadius: 999,
            background: "rgba(6,12,28,0.35)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          <Icon name="calendar" size={12} strokeWidth={2.4} />
          {area.status}
        </div>
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 10,
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: -0.3,
          }}
        >
          {area.name}
        </div>
      </div>

      <div
        style={{
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 12, color: APP.textSoft, fontWeight: 600 }}>Clique para agendar</span>
        <AppButton
          label="Reservar"
          icon="chevron"
          tapAt={withTap ? T.tapReservar : undefined}
          delay={stagger(index, 7, T.cards) + 4}
          style={{ padding: "9px 16px", fontSize: 12.5, borderRadius: 999 }}
        />
      </div>
    </div>
  );
};

const ReservationSheet: React.FC = () => {
  const days = ["SEX 11", "SÁB 12", "DOM 13"];
  const hours = ["18h", "20h", "22h"];

  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Espaço Gourmet</div>
      <div style={{ fontSize: 12, color: APP.textSoft, marginBottom: 16 }}>
        Escolha o dia e o horário da reserva
      </div>

      <div style={{ display: "flex", gap: 9, marginBottom: 14 }}>
        {days.map((day, index) => (
          <SelectChip key={day} label={day} active={index === 1} delay={T.sheet + 6 + index * 3} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 9, marginBottom: 20 }}>
        {hours.map((hour, index) => (
          <SelectChip key={hour} label={hour} active={index === 1} delay={T.sheet + 14 + index * 3} />
        ))}
      </div>

      <AppButton
        label="Confirmar reserva"
        icon="check"
        tapAt={T.confirm}
        delay={T.sheet + 20}
        style={{ padding: "16px 20px", fontSize: 15, borderRadius: 18 }}
      />
      <div style={{ fontSize: 11, color: APP.textSoft, textAlign: "center", marginTop: 12 }}>
        O acesso facial é liberado automaticamente no horário
      </div>
    </>
  );
};

const SelectChip: React.FC<{ label: string; active: boolean; delay: number }> = ({
  label,
  active,
  delay,
}) => {
  const enter = useSpringIn(delay, SPRING.pop);

  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        padding: "13px 0",
        borderRadius: 16,
        fontSize: 13,
        fontWeight: 700,
        color: active ? "#fff" : APP.textSoft,
        background: active ? `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})` : APP.surface,
        border: `1px solid ${active ? "transparent" : APP.border}`,
        opacity: enter,
        transform: `scale(${interpolate(enter, [0, 1], [0.88, 1])})`,
      }}
    >
      {label}
    </div>
  );
};

const SuccessOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(T.success, SPRING.glide);
  if (frame < T.success - 4) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(255,255,255,0.97)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        // Sobe rápido para 100%: overlay meio transparente deixa a tela suja.
        opacity: Math.min(enter * 3, 1),
      }}
    >
      <SuccessSeal at={T.success + 2} size={92} />
      <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5 }}>Reserva confirmada</div>
      <div
        style={{
          fontSize: 13,
          color: APP.textSoft,
          textAlign: "center",
          lineHeight: 1.5,
          maxWidth: 250,
        }}
      >
        Espaço Gourmet · sábado, 20h às 23h
        <br />
        Acesso facial liberado na janela da reserva
      </div>
    </div>
  );
};

export const MockAreas: React.FC = () => (
  <AppSurface background={APP.surface}>
    <StatusBar />
    <ScreenTitle title="Áreas Sociais" />
    <Segmented options={["Áreas Sociais", "Meus Agendamentos"]} active={0} delay={T.cards - 8} />

    {AREAS.map((area, index) => (
      <AreaCard key={area.name} area={area} index={index} withTap={index === 0} />
    ))}

    <TabBar active={0} />

    <Sheet openAt={T.sheet} closeAt={T.success - 10} height={352}>
      <ReservationSheet />
    </Sheet>

    <SuccessOverlay />
  </AppSurface>
);
