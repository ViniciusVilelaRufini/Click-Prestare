import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
  staticFile,
  Img,
} from "remotion";

// BRAND DESIGN SYSTEM
const COLORS = {
  clickBlue: "#00A5EC", // Vibrant sky-blue from Click logo
  clickYellow: "#FFE300", // Yellow from Click logo
  clickDark: "#111111", // Black/Dark Grey from Click logo
  prestareBlue: "#2563EB", // Prestare Blue
  prestareDarkBlue: "#1D4ED8", // Prestare Dark Blue
  prestareBgLight: "#EFF6FF", // Soft blue background
  white: "#FFFFFF",
  grayText: "#475569",
  successGreen: "#10B981",
  dangerRed: "#EF4444",
};

// Reusable SVG Grid Background with floating dots
const GridBackground: React.FC<{ variant?: "light" | "dark" | "blue" }> = ({ variant = "light" }) => {
  const frame = useCurrentFrame();
  const rotate = interpolate(frame, [0, 900], [0, 10]);
  const floatY = Math.sin(frame / 30) * 15;

  const bgStyle =
    variant === "dark"
      ? "bg-[#090D16]"
      : variant === "blue"
      ? "bg-gradient-to-br from-[#1E3A8A] to-[#1D4ED8]"
      : "bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]";

  const lineStroke =
    variant === "dark"
      ? "rgba(255,255,255,0.03)"
      : variant === "blue"
      ? "rgba(255,255,255,0.05)"
      : "rgba(0,165,236,0.06)";

  return (
    <div className={`absolute inset-0 overflow-hidden ${bgStyle}`}>
      {/* Decorative gradient glowing spots */}
      <div
        className="absolute w-[800px] h-[800px] rounded-full blur-[150px] opacity-40"
        style={{
          background: variant === "dark" ? "radial-gradient(circle, #2563EB 0%, transparent 70%)" : "radial-gradient(circle, #00A5EC 0%, transparent 75%)",
          top: "-200px",
          right: "-100px",
          transform: `translateY(${floatY}px)`,
        }}
      />
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-30"
        style={{
          background: "radial-gradient(circle, #FFE300 0%, transparent 70%)",
          bottom: "-100px",
          left: "-100px",
        }}
      />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0"
        style={{
          transform: `rotate(${rotate}deg) scale(1.15)`,
          backgroundImage: `radial-gradient(circle at 1px 1px, ${lineStroke} 1px, transparent 0)`,
          backgroundSize: "40px 40px",
        }}
      />
    </div>
  );
};

// Word Slide Up Animation for Premium Typography
const WordSlideUp: React.FC<{
  text: string;
  delay?: number;
  highlightWords?: string[];
  highlightColor?: string;
  textColor?: string;
  className?: string;
}> = ({ text, delay = 0, highlightWords = [], highlightColor = COLORS.clickBlue, textColor = "#FFFFFF", className = "" }) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const words = text.split(" ");

  return (
    <div className={`flex flex-wrap justify-center gap-x-4 gap-y-3 ${className}`}>
      {words.map((word, index) => {
        const wordDelay = delay + index * 4;
        const anim = spring({
          frame: frame - wordDelay,
          fps: config.fps,
          config: { damping: 12, stiffness: 90 },
        });

        const y = interpolate(anim, [0, 1], [80, 0]);
        const opacity = interpolate(anim, [0, 1], [0, 1]);
        const isHighlighted = highlightWords.some(
          (hw) => word.toLowerCase().replace(/[^a-zA-Z0-9áéíóúâêîôûãõç]/g, "") === hw.toLowerCase()
        );

        // Adjust text color inside highlighted boxes for maximum contrast
        const activeTextColor = isHighlighted 
          ? (highlightColor === COLORS.clickYellow ? "#111111" : "#FFFFFF") 
          : textColor;

        return (
          <div key={index} className="overflow-hidden py-1">
            <span
              className={`inline-block font-black text-5xl leading-tight font-outfit uppercase tracking-tight ${
                isHighlighted ? "px-3.5 py-0.5 rounded-xl shadow-xs" : ""
              }`}
              style={{
                transform: `translateY(${y}px)`,
                opacity,
                backgroundColor: isHighlighted ? highlightColor : "transparent",
                color: activeTextColor,
                textShadow: isHighlighted ? "none" : "0 2px 10px rgba(0,0,0,0.1)",
              }}
            >
              {word}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Floating callout card to draw syndics' attention
const FloatingCallout: React.FC<{
  title: string;
  value: string;
  iconBg: string;
  children: React.ReactNode;
  delay?: number;
  x?: number;
  y?: number;
}> = ({ title, value, iconBg, children, delay = 20, x = 0, y = 0 }) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const anim = spring({
    frame: frame - delay,
    fps: config.fps,
    config: { damping: 12, stiffness: 100 },
  });

  const scale = interpolate(anim, [0, 1], [0, 1]);
  const opacity = interpolate(anim, [0, 1], [0, 1]);
  const floatOffset = Math.sin((frame - delay) / 10) * 6;

  return (
    <div
      className="absolute bg-white/95 backdrop-blur-md border border-neutral-100 p-4 rounded-2xl shadow-xl flex items-center gap-3 z-30 pointer-events-none"
      style={{
        transform: `translate(${x}px, ${y + floatOffset}px) scale(${scale})`,
        opacity,
        minWidth: "220px",
      }}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${iconBg}`}>
        {children}
      </div>
      <div>
        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{title}</div>
        <div className="text-sm font-black text-neutral-800 font-outfit mt-0.5">{value}</div>
      </div>
    </div>
  );
};

// Smartphone UI Wrapper Component
const PhoneFrame: React.FC<{
  children: React.ReactNode;
  scale?: number;
  y?: number;
  rotate?: number;
  headerTitle?: string;
  headerSubtitle?: string;
}> = ({ children, scale = 1, y = 0, rotate = 0, headerTitle = "Edifício Demo", headerSubtitle = "Painel Síndico" }) => {
  const frame = useCurrentFrame();
  const bounce = Math.sin(frame / 20) * 8;

  return (
    <div
      className="relative w-[360px] h-[720px] bg-[#0F172A] rounded-[52px] p-3.5 border-[6px] border-[#1E293B] shadow-2xl flex flex-col overflow-hidden"
      style={{
        transform: `scale(${scale}) translateY(${y + bounce}px) rotate(${rotate}deg)`,
        boxShadow: "0 25px 60px -15px rgba(15, 23, 42, 0.4), 0 0 50px rgba(0, 165, 236, 0.15)",
        transformOrigin: "center center",
      }}
    >
      {/* Dynamic Island Notch */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-36 h-6 bg-black rounded-full z-50 flex items-center justify-center gap-2 border border-white/5">
        <div className="w-14 h-1.5 bg-neutral-900 rounded-full" />
        <div className="w-3 h-3 bg-neutral-950 rounded-full border border-neutral-800 flex items-center justify-center">
          <div className="w-1.5 h-1.5 bg-blue-900 rounded-full" />
        </div>
      </div>

      {/* Display Screen */}
      <div className="w-full h-full bg-[#F8FAFC] rounded-[42px] overflow-hidden relative flex flex-col font-sans pt-8 pb-4">
        {/* Status Bar */}
        <div className="absolute top-2 left-0 right-0 px-7 flex justify-between items-center text-[10px] font-bold text-neutral-400 z-40">
          <span>10:12</span>
          <div className="flex items-center gap-1.5">
            {/* Wi-Fi */}
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.07 19.58 10.48 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 15c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" />
            </svg>
            {/* Battery */}
            <div className="w-5.5 h-2.8 border border-neutral-300 rounded-sm p-0.5 flex items-center">
              <div className="w-3.5 h-full bg-neutral-400 rounded-3xs" />
            </div>
          </div>
        </div>

        {/* Header App Bar */}
        <div className="px-5 py-4.5 bg-white border-b border-neutral-100 flex items-center justify-between shadow-2xs">
          <div>
            <span className="text-[10px] text-neutral-400 font-extrabold uppercase tracking-widest">{headerSubtitle}</span>
            <h4 className="text-sm font-black text-neutral-800 font-outfit mt-0.5">{headerTitle}</h4>
          </div>
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#00A5EC] font-extrabold text-xs font-outfit shadow-2xs">
            SD
          </div>
        </div>

        {/* Screen Content Container */}
        <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden bg-[#F8FAFC]">
          {children}
        </div>

        {/* Home Bar Indicator */}
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-32 h-1.5 bg-neutral-300 rounded-full z-45" />
      </div>
    </div>
  );
};

// Multi-color diagonal wipe transition overlay to seamlessly connect cut borders
export const DiagonalSwipeTransition: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  // Define transition frame milestones
  const transitionPoints = [60, 150, 210, 300, 360, 450, 510, 600, 660, 750, 810];
  
  // Check if we are inside any transition window (t - 8 to t + 8)
  const currentTransition = transitionPoints.find((t) => frame >= t - 8 && frame <= t + 8);

  if (!currentTransition) return null;

  const localFrame = frame - (currentTransition - 8); // 0 to 16

  // 3 overlapping diagonal bands with slight delays
  const progress1 = spring({ frame: localFrame, fps: config.fps, config: { damping: 15, stiffness: 120 } });
  const progress2 = spring({ frame: localFrame - 2, fps: config.fps, config: { damping: 15, stiffness: 120 } });
  const progress3 = spring({ frame: localFrame - 4, fps: config.fps, config: { damping: 15, stiffness: 120 } });

  const x1 = interpolate(progress1, [0, 1], [-110, 110]);
  const x2 = interpolate(progress2, [0, 1], [-110, 110]);
  const x3 = interpolate(progress3, [0, 1], [-110, 110]);

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Band 1 - Click Blue */}
      <div
        className="absolute inset-0 bg-[#00A5EC] opacity-90 shadow-2xl"
        style={{
          transform: `skewX(-18deg) translateX(${x1}%)`,
          width: "120%",
        }}
      />
      {/* Band 2 - Click Yellow */}
      <div
        className="absolute inset-0 bg-[#FFE300] opacity-95 shadow-2xl"
        style={{
          transform: `skewX(-18deg) translateX(${x2}%)`,
          width: "120%",
        }}
      />
      {/* Band 3 - Prestare Blue */}
      <div
        className="absolute inset-0 bg-[#2563EB] shadow-2xl"
        style={{
          transform: `skewX(-18deg) translateX(${x3}%)`,
          width: "120%",
        }}
      />
    </div>
  );
};

// ==========================================
// INDIVIDUAL SCENE COMPONENT IMPLEMENTATIONS
// ==========================================

// Scene 1: Main Hook / Intro Lettering
const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="blue" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#FFE300] text-neutral-900 font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Click com Prestare
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Gestão inteligente na palma da mão."
          delay={12}
          highlightWords={["inteligente", "palma"]}
          highlightColor={COLORS.clickBlue}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-white/80 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit animate-pulse">
          A inteligência operacional do Click com a excelência da Prestare.
        </p>
      </div>
    </div>
  );
};

// Scene 2: Illustrative - Dashboard / App do Síndico
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 85 },
  });

  const isPortrait = config.height > config.width;

  const scale = interpolate(phoneEntrance, [0, 1], [0.5, isPortrait ? 0.82 : 0.95]);
  const y = interpolate(phoneEntrance, [0, 1], [400, 0]);
  const rotate = interpolate(phoneEntrance, [0, 1], [-12, 0]);

  const slideText = spring({ frame: frame - 10, fps: config.fps, config: { damping: 14 } });
  const textX = interpolate(slideText, [0, 1], [-100, 0]);
  const textY = interpolate(slideText, [0, 1], [-50, 0]);
  const textOpacity = interpolate(slideText, [0, 1], [0, 1]);

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${isPortrait ? "px-6" : "px-16"}`}>
      <GridBackground />

      <div className={`w-full z-10 flex ${isPortrait ? "flex-col gap-10 items-center justify-center text-center max-w-md" : "max-w-6xl grid grid-cols-2 gap-12 items-center"}`}>
        <div style={{ transform: isPortrait ? `translateY(${textY}px)` : `translateX(${textX}px)`, opacity: textOpacity }}>
          <span className="bg-[#00A5EC] text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg shadow-xs font-outfit">
            APP DO SÍNDICO
          </span>
          <h2 className={`${isPortrait ? "text-3xl mt-2 mb-2" : "text-5xl mt-4 mb-5"} font-black text-[#1E293B] font-outfit leading-tight`}>
            Gestão Descomplicada
          </h2>
          <p className={`${isPortrait ? "text-xs text-neutral-600 mt-2 max-w-xs mx-auto px-4" : "text-lg text-neutral-600 mt-4 leading-relaxed"} font-outfit`}>
            Monitore reservas, assembleias, pendências e a comunicação inteira do condomínio em tempo real, em um único painel integrado.
          </p>
        </div>

        <div className="flex justify-center relative shrink-0">
          {/* Floating Callouts */}
          <FloatingCallout 
            title="Moradores Ativos" 
            value="142 Apartamentos" 
            iconBg="bg-blue-500" 
            delay={25} 
            x={isPortrait ? -130 : -180} 
            y={isPortrait ? 60 : 150}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          </FloatingCallout>

          <PhoneFrame scale={scale} y={y} rotate={rotate} headerSubtitle="Condomínio Click">
            {/* Scroll Container */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              {/* Inadimplência Card */}
              <div className="bg-gradient-to-br from-[#00A5EC] to-[#2563EB] text-white p-5 rounded-2xl shadow-lg relative overflow-hidden">
                <span className="text-[9px] font-black uppercase tracking-wider text-blue-100 opacity-90">Inadimplência Geral</span>
                <div className="text-2xl font-black mt-1 font-outfit">R$ 32.357,88</div>
                <div className="text-[9px] text-blue-200 mt-2 flex items-center gap-1.5 font-outfit">
                  <span className="w-2 h-2 rounded-full bg-[#FFE300] inline-block animate-pulse" />
                  Métricas em tempo real
                </div>
              </div>

              {/* Grid of features */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {[
                  { label: "Mudanças", color: "bg-emerald-50 text-emerald-600 border-emerald-100", icon: "🗓️" },
                  { label: "Unidades", color: "bg-blue-50 text-blue-600 border-blue-100", icon: "🏢" },
                  { label: "Áreas Comuns", color: "bg-amber-50 text-amber-600 border-amber-100", icon: "🔑" },
                  { label: "Relatórios", color: "bg-rose-50 text-rose-600 border-rose-100", icon: "📄" },
                ].map((item, index) => {
                  const itemProgress = spring({
                    frame: frame - 20 - index * 6,
                    fps: config.fps,
                    config: { damping: 12, stiffness: 90 },
                  });
                  const itemScale = interpolate(itemProgress, [0, 1], [0.8, 1]);
                  const itemOpacity = interpolate(itemProgress, [0, 1], [0, 1]);

                  return (
                    <div 
                      key={index} 
                      style={{ transform: `scale(${itemScale})`, opacity: itemOpacity }}
                      className={`p-4 rounded-xl border flex flex-col items-center justify-center text-center shadow-2xs ${item.color}`}
                    >
                      <span className="text-xl mb-1">{item.icon}</span>
                      <span className="text-[11px] font-extrabold text-neutral-700 font-outfit">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

// Scene 3: Inadimplência Lettering
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="dark" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#EF4444] text-white font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Saúde Financeira
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Inadimplência sob controle absoluto."
          delay={12}
          highlightWords={["controle", "absoluto"]}
          highlightColor={COLORS.dangerRed}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-neutral-400 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit">
          Cobranças automatizadas e amigáveis integradas de ponta a ponta.
        </p>
      </div>
    </div>
  );
};

// Scene 4: Illustrative - Resumo Geral / Inadimplência
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 85 },
  });

  const isPortrait = config.height > config.width;

  const scale = interpolate(phoneEntrance, [0, 1], [0.5, isPortrait ? 0.82 : 0.95]);
  const y = interpolate(phoneEntrance, [0, 1], [400, 0]);
  const rotate = interpolate(phoneEntrance, [0, 1], [10, 0]);

  const slideText = spring({ frame: frame - 10, fps: config.fps, config: { damping: 14 } });
  const textX = interpolate(slideText, [0, 1], [100, 0]);
  const textY = interpolate(slideText, [0, 1], [-50, 0]);
  const textOpacity = interpolate(slideText, [0, 1], [0, 1]);

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${isPortrait ? "px-6" : "px-16"}`}>
      <GridBackground />

      <div className={`w-full z-10 flex ${isPortrait ? "flex-col gap-10 items-center justify-center text-center max-w-md" : "max-w-6xl grid grid-cols-2 gap-12 items-center"}`}>
        {/* Text Area */}
        <div 
          className={isPortrait ? "order-1" : "order-2"}
          style={{ transform: isPortrait ? `translateY(${textY}px)` : `translateX(${textX}px)`, opacity: textOpacity }}
        >
          <span className="bg-[#EF4444] text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg shadow-xs font-outfit">
            COBRANÇA INTELIGENTE
          </span>
          <h2 className={`${isPortrait ? "text-3xl mt-2 mb-2" : "text-5xl mt-4 mb-5"} font-black text-[#1E293B] font-outfit leading-tight`}>
            Recuperação sem Atrito
          </h2>
          <p className={`${isPortrait ? "text-xs text-neutral-600 mt-2 max-w-xs mx-auto px-4" : "text-lg text-neutral-600 mt-4 leading-relaxed"} font-outfit`}>
            Elimine o desgaste das cobranças manuais. O sistema notifica, parcela e liquida taxas em atraso de forma totalmente transparente e legal.
          </p>
        </div>

        {/* Phone Mockup Area */}
        <div className={`flex justify-center relative shrink-0 ${isPortrait ? "order-2" : "order-1"}`}>
          {/* Floating Callouts */}
          <FloatingCallout 
            title="Acordos Realizados" 
            value="R$ 18.250,00" 
            iconBg="bg-emerald-500" 
            delay={25} 
            x={isPortrait ? -130 : -180} 
            y={isPortrait ? 60 : 80}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </FloatingCallout>

          <PhoneFrame scale={scale} y={y} rotate={rotate} headerSubtitle="Relatório Financeiro" headerTitle="Resumo Geral">
            {/* Body */}
            <div className="flex-1 p-5 space-y-4">
              <span className="text-[10px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Alertas Operacionais</span>

              {/* Card 1 */}
              {(() => {
                const card1Progress = spring({
                  frame: frame - 20,
                  fps: config.fps,
                  config: { damping: 12, stiffness: 90 },
                });
                const card1Scale = interpolate(card1Progress, [0, 1], [0.8, 1]);
                const card1Opacity = interpolate(card1Progress, [0, 1], [0, 1]);
                return (
                  <div 
                    style={{ transform: `scale(${card1Scale})`, opacity: card1Opacity }}
                    className="bg-rose-50 border border-rose-150 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left"
                  >
                    <span className="text-[9px] font-black uppercase tracking-wider text-rose-500 font-outfit">Inadimplência Líquida</span>
                    <div className="text-2xl font-black text-neutral-850 mt-1 font-outfit">R$ 32.357,88</div>
                    <div className="text-[9px] text-rose-600 mt-2 font-bold font-outfit">
                      ⚠️ 15 cobranças enviadas hoje
                    </div>
                  </div>
                );
              })()}

              {/* Card 2 */}
              {(() => {
                const card2Progress = spring({
                  frame: frame - 30,
                  fps: config.fps,
                  config: { damping: 12, stiffness: 90 },
                });
                const card2Scale = interpolate(card2Progress, [0, 1], [0.8, 1]);
                const card2Opacity = interpolate(card2Progress, [0, 1], [0, 1]);
                return (
                  <div 
                    style={{ transform: `scale(${card2Scale})`, opacity: card2Opacity }}
                    className="bg-amber-50 border border-amber-150 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left"
                  >
                    <span className="text-[9px] font-black uppercase tracking-wider text-[#D97706] font-outfit">Ocorrências Ativas</span>
                    <div className="text-2xl font-black text-neutral-850 mt-1 font-outfit">02 Pendências</div>
                    <div className="text-[9px] text-[#D97706] mt-2 font-bold font-outfit">
                      ⚡ 1 Crítica • Atualizado há 5m
                    </div>
                  </div>
                );
              })()}
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

// Scene 5: Financeiro Lettering
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="blue" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#FFE300] text-neutral-900 font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Controle de Caixa
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Acompanhe cada centavo ao vivo."
          delay={12}
          highlightWords={["centavo", "ao", "vivo"]}
          highlightColor={COLORS.clickBlue}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-white/80 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit">
          Saldos consolidados, fluxos de caixas e relatórios públicos.
        </p>
      </div>
    </div>
  );
};

// Scene 6: Illustrative - Financeiro / Meu Financeiro
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 85 },
  });

  const isPortrait = config.height > config.width;

  const scale = interpolate(phoneEntrance, [0, 1], [0.5, isPortrait ? 0.82 : 0.95]);
  const y = interpolate(phoneEntrance, [0, 1], [400, 0]);
  const rotate = interpolate(phoneEntrance, [0, 1], [-10, 0]);

  // Counting balance value
  const countProgress = spring({ frame: frame - 15, fps: config.fps, config: { damping: 20, stiffness: 50 } });
  const balanceValue = interpolate(countProgress, [0, 1], [-2500, 15480]);

  const slideText = spring({ frame: frame - 10, fps: config.fps, config: { damping: 14 } });
  const textX = interpolate(slideText, [0, 1], [-100, 0]);
  const textY = interpolate(slideText, [0, 1], [-50, 0]);
  const textOpacity = interpolate(slideText, [0, 1], [0, 1]);

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${isPortrait ? "px-6" : "px-16"}`}>
      <GridBackground />

      <div className={`w-full z-10 flex ${isPortrait ? "flex-col gap-10 items-center justify-center text-center max-w-md" : "max-w-6xl grid grid-cols-2 gap-12 items-center"}`}>
        <div style={{ transform: isPortrait ? `translateY(${textY}px)` : `translateX(${textX}px)`, opacity: textOpacity }}>
          <span className="bg-[#10B981] text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg shadow-xs font-outfit">
            TRANSPARÊNCIA TOTAL
          </span>
          <h2 className={`${isPortrait ? "text-3xl mt-2 mb-2" : "text-5xl mt-4 mb-5"} font-black text-[#1E293B] font-outfit leading-tight`}>
            Contas Conciliadas
          </h2>
          <p className={`${isPortrait ? "text-xs text-neutral-600 mt-2 max-w-xs mx-auto px-4" : "text-lg text-neutral-600 mt-4 leading-relaxed"} font-outfit`}>
            Moradores e gestores visualizam relatórios idênticos, eliminando dúvidas e aumentando a confiança de forma rápida e segura.
          </p>
        </div>

        <div className="flex justify-center relative shrink-0">
          {/* Floating Callouts */}
          <FloatingCallout 
            title="Receitas Condominiais" 
            value="R$ 16.680,00" 
            iconBg="bg-emerald-500" 
            delay={25} 
            x={isPortrait ? 130 : 180} 
            y={isPortrait ? 60 : 150}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </FloatingCallout>

          <PhoneFrame scale={scale} y={y} rotate={rotate} headerSubtitle="Gestão Financeira" headerTitle="Fluxo de Caixa">
            {/* Body */}
            <div className="flex-1 p-5 space-y-4">
              {/* Balance Widget */}
              <div className="bg-white p-5 rounded-2xl border border-neutral-150 shadow-xs text-center">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-outfit">SALDO DA CONTA</span>
                <div className={`text-2xl font-black mt-1.5 font-outfit ${balanceValue >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  R$ {Math.round(balanceValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </div>
                <div className="text-[9px] text-neutral-400 font-semibold mt-1">Ref: Junho / 2026</div>
              </div>

              {/* Activity */}
              <div className="space-y-2.5">
                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Últimos Lançamentos</span>

                {/* List Item 1 */}
                {(() => {
                  const item1Progress = spring({
                    frame: frame - 25,
                    fps: config.fps,
                    config: { damping: 12, stiffness: 90 },
                  });
                  const item1X = interpolate(item1Progress, [0, 1], [50, 0]);
                  const item1Opacity = interpolate(item1Progress, [0, 1], [0, 1]);

                  return (
                    <div 
                      style={{ transform: `translateX(${item1X}px)`, opacity: item1Opacity }}
                      className="flex items-center justify-between p-3.5 bg-white border border-neutral-100 rounded-xl text-left"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                          ✓
                        </div>
                        <div>
                          <div className="text-[11px] font-black text-neutral-800 font-outfit">Taxas Condominiais</div>
                          <div className="text-[9px] text-neutral-400 font-bold">Unidades Diversas</div>
                        </div>
                      </div>
                      <div className="text-xs font-black text-emerald-500 font-outfit">+ R$ 16.680</div>
                    </div>
                  );
                })()}

                {/* List Item 2 */}
                {(() => {
                  const item2Progress = spring({
                    frame: frame - 35,
                    fps: config.fps,
                    config: { damping: 12, stiffness: 90 },
                  });
                  const item2X = interpolate(item2Progress, [0, 1], [50, 0]);
                  const item2Opacity = interpolate(item2Progress, [0, 1], [0, 1]);

                  return (
                    <div 
                      style={{ transform: `translateX(${item2X}px)`, opacity: item2Opacity }}
                      className="flex items-center justify-between p-3.5 bg-white border border-neutral-100 rounded-xl text-left"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-xs">
                          ✗
                        </div>
                        <div>
                          <div className="text-[11px] font-black text-neutral-800 font-outfit">Manutenção do Portão</div>
                          <div className="text-[9px] text-neutral-400 font-bold">Fornecedor Metalurgica</div>
                        </div>
                      </div>
                      <div className="text-xs font-black text-rose-500 font-outfit">- R$ 1.200</div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

// Scene 7: Lançamentos Lettering
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="dark" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#00A5EC] text-white font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Adeus Burocracia
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Lançamentos e conciliação em segundos."
          delay={12}
          highlightWords={["lançamentos", "segundos"]}
          highlightColor={COLORS.clickBlue}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-neutral-400 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit">
          Envie faturas e faça a conciliação bancária de forma rápida.
        </p>
      </div>
    </div>
  );
};// Scene 8: Illustrative - Novo Lançamento Form
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 85 },
  });

  const isPortrait = config.height > config.width;

  const scale = interpolate(phoneEntrance, [0, 1], [0.5, isPortrait ? 0.82 : 0.95]);
  const y = interpolate(phoneEntrance, [0, 1], [400, isPortrait ? 200 : 0]);
  const rotate = interpolate(phoneEntrance, [0, 1], [8, 0]);

  // Typing inputs
  const fill1 = frame >= 20;
  const fill2 = frame >= 40;
  
  // Submit checkmark
  const submitted = frame >= 65;
  const successScale = spring({ frame: frame - 65, fps: config.fps, config: { damping: 10 } });

  const slideText = spring({ frame: frame - 10, fps: config.fps, config: { damping: 14 } });
  const textX = interpolate(slideText, [0, 1], [100, 0]);
  const textY = interpolate(slideText, [0, 1], [-50, 0]);
  const textOpacity = interpolate(slideText, [0, 1], [0, 1]);

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${isPortrait ? "px-6" : "px-16"}`}>
      <GridBackground />

      <div className={`w-full z-10 flex ${isPortrait ? "flex-col gap-10 items-center justify-center text-center max-w-md" : "max-w-6xl grid grid-cols-2 gap-12 items-center"}`}>
        {/* Text Area */}
        <div 
          className={isPortrait ? "order-1" : "order-2"}
          style={{ transform: isPortrait ? `translateY(${textY}px)` : `translateX(${textX}px)`, opacity: textOpacity }}
        >
          <span className="bg-[#00A5EC] text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg shadow-xs font-outfit">
            ADMINISTRAÇÃO VELOZ
          </span>
          <h2 className={`${isPortrait ? "text-3xl mt-2 mb-2" : "text-5xl mt-4 mb-5"} font-black text-[#1E293B] font-outfit leading-tight`}>
            Lançamentos Express
          </h2>
          <p className={`${isPortrait ? "text-xs text-neutral-600 mt-2 max-w-xs mx-auto px-4" : "text-lg text-neutral-600 mt-4 leading-relaxed"} font-outfit`}>
            Agende cobranças recorrentes, configure multas automáticas e processe pagamentos com envio automático diretamente no celular dos moradores.
          </p>
        </div>

        {/* Phone Mockup Area */}
        <div className={`flex justify-center relative shrink-0 ${isPortrait ? "order-2" : "order-1"}`}>
          <PhoneFrame scale={scale} y={y} rotate={rotate} headerSubtitle="Painel Administrativo" headerTitle="Novo Lançamento">
            {/* Body */}
            <div className="flex-1 p-5 space-y-4 relative">
              
              {/* Field 1 */}
              <div className="space-y-1.5 text-left">
                <label className="text-[9px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Apartamento / Morador</label>
                <div 
                  className={`w-full h-11 bg-neutral-50 rounded-xl border flex items-center px-4 text-xs font-bold font-outfit shadow-2xs transition-all duration-200 ${
                    frame >= 10 && frame < 30 
                      ? "border-blue-500 ring-2 ring-blue-100 bg-white text-neutral-855" 
                      : "border-neutral-200 text-neutral-700"
                  }`}
                >
                  {fill1 ? (
                    <span>Apt 102 (Marcela Silva)</span>
                  ) : (
                    frame >= 10 && <span className="text-blue-500 animate-pulse">|</span>
                  )}
                </div>
              </div>

              {/* Field 2 */}
              <div className="space-y-1.5 text-left">
                <label className="text-[9px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Categoria do Lançamento</label>
                <div 
                  className={`w-full h-11 bg-neutral-50 rounded-xl border flex items-center px-4 text-xs font-bold font-outfit shadow-2xs transition-all duration-200 ${
                    frame >= 30 && frame < 50 
                      ? "border-blue-500 ring-2 ring-blue-100 bg-white text-neutral-855" 
                      : "border-neutral-200 text-neutral-700"
                  }`}
                >
                  {fill2 ? (
                    <span>Taxa Ordinária Condominial</span>
                  ) : (
                    frame >= 30 && <span className="text-blue-500 animate-pulse">|</span>
                  )}
                </div>
              </div>

              {/* Field 3 */}
              <div className="space-y-1.5 text-left">
                <label className="text-[9px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Valor Cobrado</label>
                <div 
                  className={`w-full h-11 bg-neutral-50 rounded-xl border flex items-center px-4 text-xs font-bold text-neutral-700 font-outfit shadow-2xs transition-all duration-200 ${
                    frame >= 50 && frame < 65 
                      ? "border-blue-500 ring-2 ring-blue-100 bg-white" 
                      : "border-neutral-200"
                  }`}
                >
                  R$ 450,00
                </div>
              </div>

              {/* Submit button wrapper */}
              <div className="pt-2">
                <div 
                  className={`w-full h-11 rounded-xl flex items-center justify-center text-white text-xs font-bold font-outfit shadow-md transition-all duration-150 ${
                    frame >= 50 && frame < 65 
                      ? "bg-[#1D4ED8] scale-[0.97] shadow-inner" 
                      : "bg-[#2563EB]"
                  }`}
                >
                  Confirmar e Gerar Cobrança
                </div>
              </div>

              {/* Success animation overlay */}
              {submitted && (
                <div
                  className="absolute inset-0 bg-white/95 rounded-[40px] flex flex-col items-center justify-center p-6 text-center z-50 shadow-2xl animate-fade-in"
                  style={{
                    transform: `scale(${successScale})`,
                    opacity: interpolate(successScale, [0, 1], [0, 1]),
                  }}
                >
                  <div className="w-18 h-18 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-3xl mb-4 shadow-xs">
                    ✓
                  </div>
                  <h4 className="text-lg font-black text-neutral-800 font-outfit">Fatura Emitida!</h4>
                  <p className="text-xs text-neutral-500 font-outfit mt-2">
                    Lançamento concluído com sucesso e notificação enviada por WhatsApp.
                  </p>
                </div>
              )}
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

// Scene 9: Comunicação Lettering
const Scene9: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="blue" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#FFE300] text-neutral-900 font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Conexão Sem Ruídos
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Comunicação direta entre síndico e moradores."
          delay={12}
          highlightWords={["comunicação", "direta"]}
          highlightColor={COLORS.clickBlue}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-white/80 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit">
          Mural de avisos, liberação de portaria e agendamento de áreas comuns.
        </p>
      </div>
    </div>
  );
};

// Scene 10: Illustrative - Portaria / Acesso
const Scene10: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 85 },
  });

  const isPortrait = config.height > config.width;

  const scale = interpolate(phoneEntrance, [0, 1], [0.5, isPortrait ? 0.82 : 0.95]);
  const y = interpolate(phoneEntrance, [0, 1], [400, 0]);
  const rotate = interpolate(phoneEntrance, [0, 1], [-12, 0]);

  // Status transitions
  const approved = frame >= 50;
  const statusBg = approved ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200";
  const statusColor = approved ? "text-emerald-700" : "text-amber-700";
  const statusText = approved ? "Acesso Autorizado ✓" : "Aguardando Resposta...";

  const slideText = spring({ frame: frame - 10, fps: config.fps, config: { damping: 14 } });
  const textX = interpolate(slideText, [0, 1], [-100, 0]);
  const textY = interpolate(slideText, [0, 1], [-50, 0]);
  const textOpacity = interpolate(slideText, [0, 1], [0, 1]);

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${isPortrait ? "px-6" : "px-16"}`}>
      <GridBackground />

      <div className={`w-full z-10 flex ${isPortrait ? "flex-col gap-10 items-center justify-center text-center max-w-md" : "max-w-6xl grid grid-cols-2 gap-12 items-center"}`}>
        <div style={{ transform: isPortrait ? `translateY(${textY}px)` : `translateX(${textX}px)`, opacity: textOpacity }}>
          <span className="bg-[#FFE300] text-neutral-900 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg shadow-xs font-outfit">
            PORTARIA DIGITAL
          </span>
          <h2 className={`${isPortrait ? "text-3xl mt-2 mb-2" : "text-5xl mt-4 mb-5"} font-black text-[#1E293B] font-outfit leading-tight`}>
            Acesso Inteligente
          </h2>
          <p className={`${isPortrait ? "text-xs text-neutral-600 mt-2 max-w-xs mx-auto px-4" : "text-lg text-neutral-600 mt-4 leading-relaxed"} font-outfit`}>
            Libere visitantes, acompanhe a chegada de correspondências e gerencie prestadores de serviços de forma ágil e sem sair de casa.
          </p>
        </div>

        <div className="flex justify-center relative shrink-0">
          <PhoneFrame scale={scale} y={y} rotate={rotate} headerSubtitle="Segurança e Acesso" headerTitle="Portaria Click">
            {/* Body */}
            <div className="flex-1 p-5 space-y-4">
              <span className="text-[10px] font-black text-neutral-400 uppercase tracking-wider font-outfit">Pré-Autorização de Visitante</span>

              {(() => {
                const cardProgress = spring({
                  frame: frame - 20,
                  fps: config.fps,
                  config: { damping: 12, stiffness: 90 },
                });
                const cardY = interpolate(cardProgress, [0, 1], [30, 0]);
                const cardOpacity = interpolate(cardProgress, [0, 1], [0, 1]);

                const gridProgress = spring({
                  frame: frame - 30,
                  fps: config.fps,
                  config: { damping: 12, stiffness: 90 },
                });
                const gridX = interpolate(gridProgress, [0, 1], [30, 0]);
                const gridOpacity = interpolate(gridProgress, [0, 1], [0, 1]);

                const statusProgress = spring({
                  frame: frame - 50,
                  fps: config.fps,
                  config: { damping: 10, stiffness: 120 },
                });
                const statusScale = frame >= 50 ? interpolate(statusProgress, [0, 1], [0.95, 1]) : 1;

                return (
                  <div 
                    style={{ transform: `translateY(${cardY}px)`, opacity: cardOpacity }}
                    className="bg-white border border-neutral-200 p-5 rounded-2xl shadow-xs space-y-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 font-bold flex items-center justify-center">
                        MA
                      </div>
                      <div className="text-left">
                        <h5 className="text-xs font-black text-neutral-850 font-outfit">Mateus Andrade</h5>
                        <p className="text-[10px] text-neutral-400 font-bold font-outfit">RG: 48.910.111-X</p>
                      </div>
                    </div>

                    <div 
                      style={{ transform: `translateX(${gridX}px)`, opacity: gridOpacity }}
                      className="grid grid-cols-2 gap-3 text-[10px] text-neutral-500 border-t border-b border-neutral-100 py-3.5 font-outfit text-left"
                    >
                      <div>
                        <div className="font-bold text-neutral-400">APARTAMENTO</div>
                        <div className="font-bold text-neutral-700 mt-0.5">Apt 102</div>
                      </div>
                      <div>
                        <div className="font-bold text-neutral-400">PARENTESCO</div>
                        <div className="font-bold text-neutral-700 mt-0.5">Familiar</div>
                      </div>
                    </div>

                    {/* Status Bar Indicator */}
                    <div 
                      style={{ transform: `scale(${statusScale})` }}
                      className={`border rounded-xl px-4 py-3 text-center font-bold text-[10px] font-outfit transition-all duration-200 ${statusBg} ${statusColor}`}
                    >
                      {statusText}
                    </div>
                  </div>
                );
              })()}
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

const Scene11: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const titleAnim = spring({ frame, fps: config.fps, config: { damping: 12 } });
  const scale = interpolate(titleAnim, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 10, 50, 60], [0, 1, 1, 0]);

  const isPortrait = config.height > config.width;

  return (
    <div className={`w-full h-full flex items-center justify-center relative text-center overflow-hidden ${isPortrait ? "px-8" : "px-16"}`}>
      <GridBackground variant="blue" />
      <div className="z-10 flex flex-col items-center justify-center" style={{ transform: `scale(${scale})`, opacity }}>
        <span className="bg-[#FFE300] text-neutral-900 font-extrabold text-sm tracking-widest uppercase px-4 py-1.5 rounded-full shadow-md font-outfit">
          Próximo Passo
        </span>
        <div className="h-6" />
        <WordSlideUp
          text="Inove na gestão do seu condomínio."
          delay={12}
          highlightWords={["inove", "condomínio."]}
          highlightColor={COLORS.clickBlue}
          className={isPortrait ? "max-w-md text-3xl" : "max-w-4xl"}
        />
        <div className="h-6" />
        <p className="text-white/80 text-lg font-medium tracking-wide max-w-2xl mx-auto font-outfit">
          Mais controle para o síndico, melhor vivência para o morador.
        </p>
      </div>
    </div>
  );
};

// Scene 12: Final Outro / Logo Reveal / CTA
const Scene12: React.FC = () => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();

  const logoProgress = spring({
    frame,
    fps: config.fps,
    config: { damping: 14, stiffness: 60 },
  });

  const logoScale = interpolate(logoProgress, [0, 1], [0.7, 1]);
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);

  const textProgress = spring({
    frame: frame - 40,
    fps: config.fps,
    config: { damping: 14, stiffness: 60 },
  });
  const textY = interpolate(textProgress, [0, 1], [50, 0]);
  const textOpacity = interpolate(textProgress, [0, 1], [0, 1]);

  // Fade out slightly at the absolute end
  const exitOpacity = interpolate(frame, [100, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const isPortrait = config.height > config.width;

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center bg-white text-center relative ${isPortrait ? "px-6 pt-12" : "px-12"}`}
      style={{ opacity: exitOpacity }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Background Shapes */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-blue-50/50 to-indigo-50/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-emerald-50/50 to-green-50/30 rounded-full blur-3xl pointer-events-none" />

      {/* Logos side-by-side */}
      <div
        className={`flex items-center justify-center gap-8 ${isPortrait ? "mb-6 scale-[0.8]" : "mb-10"}`}
        style={{
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
        }}
      >
        {/* Click Logo */}
        <Img
          src={staticFile("logo.png")}
          alt="Click Logo"
          className="w-28 h-28 rounded-2xl shadow-md object-cover"
        />

        {/* Separator / Plus */}
        <div className="text-neutral-300 text-3xl font-light font-outfit">+</div>

        {/* Prestare Logo Card */}
        <div className="bg-[#2563EB] rounded-2xl shadow-md p-4 flex items-center justify-center w-28 h-28">
          <Img
            src={staticFile("logo_prestare.png")}
            alt="Prestare Logo"
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      {/* Bottom Content Area */}
      <div
        className={`flex ${isPortrait ? "flex-col gap-8 items-center text-center pb-8" : "flex-row gap-16 text-left max-w-4xl"} items-center justify-center w-full`}
        style={{
          transform: `translateY(${textY}px)`,
          opacity: textOpacity,
        }}
      >
        {/* Left: Text & CTA */}
        <div className={isPortrait ? "text-center" : "text-left flex-1"}>
          <span className="text-[#00A5EC] font-bold text-xs tracking-widest uppercase mb-1 block font-outfit">
            ADMINISTRAÇÃO INTELIGENTE
          </span>
          <h2 className={`${isPortrait ? "text-2xl mb-4" : "text-3xl mb-5"} text-neutral-900 font-black font-outfit leading-tight`}>
            Fale com seu gestor Prestare e ative o Click hoje mesmo!
          </h2>
          <div className="text-sm text-white font-extrabold font-outfit tracking-wide bg-[#2563EB] px-5 py-2.5 rounded-full shadow-md inline-block border border-blue-600">
            www.prestaregestao.com.br
          </div>
        </div>

        {/* Right: QR Code Card */}
        <div className="bg-white border border-neutral-100 rounded-3xl p-4 shadow-lg flex flex-col items-center justify-center w-40 shrink-0">
          <Img
            src={staticFile("qrcode.png")}
            alt="QR Code"
            className="w-24 h-24 object-contain mb-1.5"
          />
          <div className="text-[9px] text-neutral-400 font-bold uppercase font-outfit tracking-wider text-center">
            Escaneie para baixar
          </div>
          <div className="text-[10px] text-[#2563EB] font-extrabold font-outfit mt-0.5 text-center">
            Google Play Store
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN VIDEO COMPOSITION ROOT
// ==========================================
export const PrestareVideo: React.FC = () => {
  return (
    <div className="w-full h-full bg-black relative">
      {/* 1. Lettering 1 */}
      <Sequence durationInFrames={60}>
        <Scene1 />
      </Sequence>

      {/* 2. Illustrative 1 (Dashboard) */}
      <Sequence from={60} durationInFrames={90}>
        <Scene2 />
      </Sequence>

      {/* 3. Lettering 2 */}
      <Sequence from={150} durationInFrames={60}>
        <Scene3 />
      </Sequence>

      {/* 4. Illustrative 2 (Resumo Geral) */}
      <Sequence from={210} durationInFrames={90}>
        <Scene4 />
      </Sequence>

      {/* 5. Lettering 3 */}
      <Sequence from={300} durationInFrames={60}>
        <Scene5 />
      </Sequence>

      {/* 6. Illustrative 3 (Financeiro) */}
      <Sequence from={360} durationInFrames={90}>
        <Scene6 />
      </Sequence>

      {/* 7. Lettering 4 */}
      <Sequence from={450} durationInFrames={60}>
        <Scene7 />
      </Sequence>

      {/* 8. Illustrative 4 (Novo Lançamento) */}
      <Sequence from={510} durationInFrames={90}>
        <Scene8 />
      </Sequence>

      {/* 9. Lettering 5 */}
      <Sequence from={600} durationInFrames={60}>
        <Scene9 />
      </Sequence>

      {/* 10. Illustrative 5 (Portaria) */}
      <Sequence from={660} durationInFrames={90}>
        <Scene10 />
      </Sequence>

      {/* 11. Lettering 6 */}
      <Sequence from={750} durationInFrames={60}>
        <Scene11 />
      </Sequence>

      {/* 12. Outro (Logos & CTA) */}
      <Sequence from={810} durationInFrames={120}>
        <Scene12 />
      </Sequence>

      {/* Global Diagonal Swipe Transitions */}
      <DiagonalSwipeTransition />
    </div>
  );
};
