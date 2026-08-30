import React from "react";
import { AbsoluteFill } from "remotion";
import { Headline, Kicker } from "../components/Type";
import { Phone, PhoneHalo } from "../components/Phone";
import { BulletStrip } from "../components/Glass";

/**
 * Layout único das cenas de produto.
 * As quatro features só trocam copy, cor e a tela renderizada dentro do
 * device — o ritmo de entrada é idêntico, que é o que dá coesão à sequência.
 */
export const FeatureScene: React.FC<{
  kicker: string;
  headline: string;
  highlight: string[];
  bullets: string[];
  accent: string;
  tilt?: number;
  children: React.ReactNode;
}> = ({ kicker, headline, highlight, bullets, accent, tilt = 0, children }) => (
  <AbsoluteFill
    style={{
      flexDirection: "column",
      alignItems: "center",
      padding: "104px 0 92px",
    }}
  >
    <div
      style={{
        width: "100%",
        padding: "0 80px",
        display: "flex",
        flexDirection: "column",
        gap: 30,
      }}
    >
      <Kicker label={kicker} accent={accent} delay={2} />
      <Headline
        text={headline}
        highlight={highlight}
        accent={accent}
        size={74}
        delay={8}
        maxWidth={880}
      />
    </div>

    <div
      style={{
        position: "relative",
        flex: 1,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 26,
      }}
    >
      <PhoneHalo color={accent} delay={12} />
      <Phone delay={14} tilt={tilt}>
        {children}
      </Phone>
    </div>

    <BulletStrip items={bullets} accent={accent} delay={40} />
  </AbsoluteFill>
);
