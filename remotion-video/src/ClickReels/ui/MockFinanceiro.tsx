import React from "react";
import { interpolate, interpolateColors, random, useCurrentFrame } from "remotion";
import { APP, EASE, SPRING } from "../theme";
import { stagger, useSpringIn } from "../lib/animation";
import { StatusBar, ScreenTitle, TabBar } from "../components/Phone";
import { AppButton, AppCard, AppSurface, IconBadge, Segmented, Sheet, SuccessSeal } from "./kit";
import { Icon, type IconName } from "../components/Icons";

const T = {
  card: 18,
  tiles: 34,
  openPix: 66,
  confirm: 98,
  paid: 106,
};

const AMOUNT = 732.6;
const MONTHS = ["JUN", "JUL", "AGO", "SET", "OUT"];
const ACCOUNTS: { label: string; icon: IconName; color: string; badge?: number }[] = [
  { label: "Condomínio", icon: "home", color: APP.blue, badge: 1 },
  { label: "Água", icon: "wallet", color: "#00A5EC" },
  { label: "Luz", icon: "sparkles", color: APP.amber },
  { label: "Internet", icon: "chart", color: "#7C5CFF" },
];

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BalanceCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(T.card, SPRING.glide);

  // Sobe até o valor devido e, depois do Pix, desce até zero.
  const rising = interpolate(frame, [T.card + 6, T.card + 34], [0, AMOUNT], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const settling = interpolate(frame, [T.paid, T.paid + 22], [1, 0], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const value = rising * settling;

  const paidMix = interpolate(frame, [T.paid, T.paid + 16], [0, 1], {
    easing: EASE.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const background = interpolateColors(paidMix, [0, 1], [APP.blue, APP.green]);
  const backgroundDeep = interpolateColors(paidMix, [0, 1], [APP.blueDeep, "#0B7A58"]);

  return (
    <div
      style={{
        margin: "0 22px 18px",
        padding: "22px 24px",
        borderRadius: 26,
        background: `linear-gradient(150deg, ${background}, ${backgroundDeep})`,
        color: "#fff",
        boxShadow: `0 22px 44px -24px ${background}`,
        opacity: Math.min(enter * 1.6, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [40, 0])}px, 0) scale(${interpolate(
          enter,
          [0, 1],
          [0.95, 1],
        )})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.85 }}>
          {paidMix > 0.5 ? "Tudo em dia" : "Total pendente"}
        </span>
        <Icon name={paidMix > 0.5 ? "check" : "clock"} size={17} strokeWidth={2.4} color="#fff" />
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 38,
          fontWeight: 900,
          letterSpacing: -1.4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        R$ {formatBRL(value)}
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.8 }}>
        {paidMix > 0.5 ? "Pago via Pix · comprovante no app" : "Vence em 10/08 · Edifício Demo"}
      </div>
    </div>
  );
};

const MonthStrip: React.FC = () => {
  const enter = useSpringIn(T.card - 8, SPRING.glide);

  return (
    <div
      style={{
        margin: "0 22px 16px",
        padding: 6,
        borderRadius: 18,
        background: APP.surface,
        display: "flex",
        alignItems: "center",
        gap: 4,
        opacity: enter,
      }}
    >
      {MONTHS.map((month, index) => (
        <div
          key={month}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "9px 0",
            borderRadius: 13,
            fontSize: 12,
            fontWeight: 800,
            color: index === 2 ? "#fff" : APP.textSoft,
            background: index === 2 ? `linear-gradient(150deg, ${APP.blue}, ${APP.blueDeep})` : "transparent",
          }}
        >
          {month}
          <div style={{ fontSize: 9, opacity: 0.65, fontWeight: 600 }}>26</div>
        </div>
      ))}
    </div>
  );
};

const AccountsGrid: React.FC = () => (
  <div
    style={{
      margin: "0 22px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    }}
  >
    {ACCOUNTS.map((account, index) => (
      <AppCard key={account.label} delay={stagger(index, 5, T.tiles)} padding={14} radius={20}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <IconBadge name={account.icon} color={account.color} size={36} />
          {account.badge ? (
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: APP.red,
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {account.badge}
            </div>
          ) : null}
        </div>
        <div style={{ marginTop: 12, fontSize: 13.5, fontWeight: 700 }}>{account.label}</div>
      </AppCard>
    ))}
  </div>
);

/** QR determinístico: `random` do Remotion garante o mesmo padrão em todo frame. */
const PixCode: React.FC = () => {
  const cells = 13;

  return (
    <div
      style={{
        width: 128,
        height: 128,
        padding: 8,
        borderRadius: 16,
        background: "#fff",
        border: `1px solid ${APP.border}`,
        display: "grid",
        gridTemplateColumns: `repeat(${cells}, 1fr)`,
        gap: 1.5,
      }}
    >
      {new Array(cells * cells).fill(0).map((_, index) => {
        const row = Math.floor(index / cells);
        const col = index % cells;
        const isAnchor =
          (row < 3 && col < 3) || (row < 3 && col > cells - 4) || (row > cells - 4 && col < 3);
        const on = isAnchor || random(`pix-${index}`) > 0.55;
        return (
          <div
            key={index}
            style={{
              background: on ? APP.text : "transparent",
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
};

export const MockFinanceiro: React.FC = () => (
  <AppSurface background={APP.surface}>
    <StatusBar />
    <ScreenTitle title="Financeiro" />
    <Segmented options={["MEU FINANCEIRO", "CONDOMÍNIO"]} active={0} delay={T.card - 12} />
    <MonthStrip />
    <BalanceCard />

    <div
      style={{
        margin: "0 22px 12px",
        fontSize: 12,
        fontWeight: 800,
        color: APP.textSoft,
        letterSpacing: 0.6,
      }}
    >
      CONTAS
    </div>
    <AccountsGrid />

    <TabBar active={4} />

    <Sheet openAt={T.openPix} closeAt={T.paid} height={366}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <IconBadge name="pix" color={APP.green} size={40} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Pagar com Pix</div>
          <div style={{ fontSize: 11.5, color: APP.textSoft }}>Taxa condominial · agosto/26</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
        <PixCode />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: APP.textSoft }}>Valor</div>
          <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: -1 }}>R$ {formatBRL(AMOUNT)}</div>
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 12,
              background: APP.surface,
              fontSize: 10.5,
              color: APP.textSoft,
              fontFamily: "monospace",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            00020126BR.GOV.BCB.PIX…
          </div>
        </div>
      </div>

      <AppButton
        label="Confirmar pagamento"
        icon="check"
        tapAt={T.confirm}
        delay={T.openPix + 12}
        style={{ padding: "16px 20px", fontSize: 15, borderRadius: 18 }}
      />
    </Sheet>

    <PaidToast />
  </AppSurface>
);

const PaidToast: React.FC = () => {
  const enter = useSpringIn(T.paid + 6, SPRING.pop);

  return (
    <div
      style={{
        position: "absolute",
        left: 22,
        right: 22,
        top: 60,
        padding: "14px 16px",
        borderRadius: 20,
        background: "#fff",
        border: `1px solid ${APP.border}`,
        boxShadow: "0 18px 40px -20px rgba(12,22,51,0.5)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: Math.min(enter * 1.5, 1),
        transform: `translate3d(0, ${interpolate(enter, [0, 1], [-70, 0])}px, 0)`,
      }}
    >
      <SuccessSeal at={T.paid + 8} size={36} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Pagamento confirmado</div>
        <div style={{ fontSize: 11, color: APP.textSoft }}>Comprovante salvo no financeiro</div>
      </div>
    </div>
  );
};
