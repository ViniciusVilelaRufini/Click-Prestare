import React from "react";

/**
 * Ícones inline (stroke, 24x24, currentColor).
 * SVG inline em vez de fonte de ícones/imagem: zero request, zero flash
 * de asset faltando no render e escala perfeita em 1080x1920.
 */
export type IconName =
  | "face"
  | "calendar"
  | "wallet"
  | "sparkles"
  | "package"
  | "car"
  | "users"
  | "bell"
  | "chart"
  | "shield"
  | "doc"
  | "vote"
  | "wrench"
  | "megaphone"
  | "truck"
  | "home"
  | "check"
  | "arrow"
  | "chat"
  | "lock"
  | "clock"
  | "plus"
  | "chevron"
  | "download"
  | "pix";

const PATHS: Record<IconName, React.ReactNode> = {
  face: (
    <>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M9 10.5v1" />
      <path d="M15 10.5v1" />
      <path d="M9.5 14.5c1.5 1.4 3.5 1.4 5 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="m9.5 15 2 2 3.5-3.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 8a3 3 0 0 1 3-3h10.5a1.5 1.5 0 0 1 0 3" />
      <rect x="3" y="8" width="18" height="12" rx="3" />
      <path d="M17 14h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.9 4.7L18.5 9.5l-4.6 1.8L12 16l-1.9-4.7L5.5 9.5l4.6-1.8z" />
      <path d="m18.5 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  package: (
    <>
      <path d="m12 2.5 8.5 4.7v9.6L12 21.5l-8.5-4.7V7.2z" />
      <path d="m3.5 7.2 8.5 4.8 8.5-4.8M12 12v9.5" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16.5v-4l1.8-4.6A2 2 0 0 1 8.2 6.6h7.6a2 2 0 0 1 1.9 1.3l1.8 4.6v4" />
      <path d="M4.5 12.5h15" />
      <circle cx="8" cy="16.8" r="1.7" />
      <circle cx="16" cy="16.8" r="1.7" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M16.5 4.4a3.2 3.2 0 0 1 0 7.2" />
      <path d="M18 14.4c2.4.8 4 3 4 5.9" />
    </>
  ),
  bell: (
    <>
      <path d="M18.5 15.5V10a6.5 6.5 0 1 0-13 0v5.5L3.5 18.5h17z" />
      <path d="M10 21.2a2.4 2.4 0 0 0 4 0" />
    </>
  ),
  chart: (
    <>
      <path d="M3 20.5h18" />
      <path d="M6 20.5v-6M12 20.5V5.5M18 20.5v-9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6.2c0 4.4 2.9 7.6 7 9 4.1-1.4 7-4.6 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  doc: (
    <>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  vote: (
    <>
      <rect x="3.5" y="9.5" width="17" height="11" rx="2.5" />
      <path d="M8 9.5V5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 5v4.5" />
      <path d="m9.5 14.5 2 2 3.5-3.5" />
    </>
  ),
  wrench: (
    <>
      <path d="M21.5 4.2a5.2 5.2 0 0 1-6.9 6.9L5 20.7a2.1 2.1 0 0 1-3-3l9.6-9.6a5.2 5.2 0 0 1 6.9-6.9l-3.1 3.1 3 3z" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3.5 10.5v3a1.5 1.5 0 0 0 1.5 1.5h1.8l6.7 4.4V4.6L6.8 9H5a1.5 1.5 0 0 0-1.5 1.5z" />
      <path d="M17.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 7.5A1.5 1.5 0 0 1 4 6h9v10.5H2.5z" />
      <path d="M13 10h4.2l3.3 3.4v3.1H13z" />
      <circle cx="7" cy="18" r="1.7" />
      <circle cx="17" cy="18" r="1.7" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 10.8 12 3.5l8.5 7.3" />
      <path d="M5.5 12.5v7a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1v-7" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  arrow: <path d="M4.5 12h14m-5.5-6 6 6-6 6" />,
  chat: (
    <>
      <path d="M20.5 5.5v9a2 2 0 0 1-2 2H9l-4.5 3.5V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M9 9h7M9 12.5h4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10.5" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  download: (
    <>
      <path d="M12 3.5v11m0 0 4.5-4.5M12 14.5 7.5 10" />
      <path d="M4.5 17v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V17" />
    </>
  ),
  pix: (
    <>
      <path d="m12 3.2 3.6 3.6a2 2 0 0 0 1.4.6h.6L20.8 11a1.5 1.5 0 0 1 0 2.1l-3.2 3.2H17a2 2 0 0 0-1.4.6L12 20.8l-3.6-3.9A2 2 0 0 0 7 16.3h-.6L3.2 13.1a1.5 1.5 0 0 1 0-2.1L6.4 7.4H7a2 2 0 0 0 1.4-.6z" />
    </>
  ),
};

export const Icon: React.FC<{
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}> = ({ name, size = 24, color = "currentColor", strokeWidth = 1.9, fill = "none" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: "block", flexShrink: 0 }}
  >
    {PATHS[name]}
  </svg>
);
