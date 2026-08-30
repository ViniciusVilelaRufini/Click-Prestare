/**
 * Design system do vídeo.
 * Tudo que é "marca" (cor, fonte, física de animação) mora aqui —
 * nenhuma cena deve declarar hex ou spring config próprio.
 */
import { Easing } from "remotion";
import { loadFont as loadDisplayFont } from "@remotion/google-fonts/Outfit";
import { loadFont as loadUiFont } from "@remotion/google-fonts/Inter";

// Carregado no import: o Remotion segura o render até as fontes estarem prontas.
const displayFont = loadDisplayFont("normal", {
  weights: ["600", "700", "800", "900"],
  subsets: ["latin"],
});

const uiFont = loadUiFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const FONT = {
  display: displayFont.fontFamily,
  ui: uiFont.fontFamily,
} as const;

export const COLORS = {
  ink: "#04070F",
  night: "#070C1B",
  navy: "#0B1633",
  brand: "#2E6BFF",
  brandDeep: "#1B3FD1",
  cyan: "#00A5EC",
  yellow: "#FFD400",
  violet: "#7C5CFF",
  mint: "#22D3A7",
  coral: "#FF5A5F",
  white: "#FFFFFF",
  mist: "#E7EEFF",
  slate: "#8FA1C7",
  line: "rgba(255,255,255,0.10)",
  glass: "rgba(255,255,255,0.055)",
} as const;

/** Paleta do "app" renderizado dentro do mockup (tema claro, igual ao produto). */
export const APP = {
  bg: "#FFFFFF",
  surface: "#F4F6FB",
  surfaceAlt: "#EAF0FF",
  border: "#E4E9F2",
  text: "#0C1633",
  textSoft: "#6B7A99",
  blue: "#2E6BFF",
  blueDeep: "#1B3FD1",
  green: "#16A97C",
  red: "#EF4444",
  amber: "#F59E0B",
} as const;

export type SpringPreset = {
  damping: number;
  stiffness: number;
  mass: number;
};

/**
 * Presets de mola. Nada de linear:
 * - silk  → entradas grandes, sem overshoot (elegante)
 * - glide → padrão de UI, overshoot quase imperceptível
 * - pop   → selos, checks, ícones (com peso e rebote)
 * - drift → movimentos ambientes, longos e lentos
 */
export const SPRING: Record<"silk" | "glide" | "pop" | "drift", SpringPreset> = {
  silk: { damping: 200, stiffness: 95, mass: 0.75 },
  glide: { damping: 26, stiffness: 120, mass: 0.9 },
  pop: { damping: 12, stiffness: 170, mass: 0.8 },
  drift: { damping: 60, stiffness: 40, mass: 1.6 },
};

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.55, 0, 1, 0.45),
} as const;

/** Hex → rgba(). Usado para tingir superfícies com a cor de acento da cena. */
export const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const SHADOW = {
  card: "0 24px 60px -20px rgba(2,7,25,0.55)",
  phone: "0 60px 140px -40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08)",
  soft: "0 10px 30px -12px rgba(11,22,51,0.25)",
} as const;
