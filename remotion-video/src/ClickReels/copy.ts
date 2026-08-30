/**
 * Todo o texto do vídeo em um só lugar.
 * Trocar copy/claim de campanha = editar este arquivo, nada mais.
 */
import type { IconName } from "./components/Icons";

export const BRAND = {
  product: "CLICK",
  company: "PRESTARE",
  tagline: "O condomínio inteiro, em um clique.",
  site: "prestare.com.br",
  handle: "@prestaregestao",
};

export const INTRO = {
  kicker: "Prestare Gestão",
  headline: "O condomínio inteiro, em um clique.",
  highlight: ["clique."],
};

export const PROBLEM = {
  kicker: "Antes",
  headline: "Grupo de zap, papelada e ligação pra portaria.",
  highlight: ["papelada", "portaria."],
  noise: [
    "Alguém viu o boleto de agosto?",
    "O salão tá livre sábado?",
    "A portaria não atende…",
    "Manda a 2ª via no meu zap",
    "Chegou encomenda pra 101?",
  ],
};

export const FEATURES = {
  portaria: {
    kicker: "Portaria & Acesso",
    headline: "Reconhecimento facial e autorização em tempo real.",
    highlight: ["facial", "real."],
    bullets: ["Facial integrado", "Autorizar no app", "Tudo registrado"],
  },
  areas: {
    kicker: "Áreas Sociais",
    headline: "Reserva do salão sem grupo e sem caderninho.",
    highlight: ["sem", "caderninho."],
    bullets: ["Agenda ao vivo", "Regras automáticas", "Só quem reservou"],
  },
  financeiro: {
    kicker: "Financeiro",
    headline: "Boleto, Pix e 2ª via na mão do morador.",
    highlight: ["Pix", "morador."],
    bullets: ["Pix em segundos", "2ª via na hora", "Contas abertas"],
  },
  ia: {
    kicker: "Click IA",
    headline: "Uma IA que resolve, não só responde.",
    highlight: ["resolve,"],
    bullets: ["Reserva áreas", "Abre ocorrência", "Puxa o boleto"],
  },
};

export const MODULES = {
  kicker: "Tudo integrado",
  headline: "13 módulos. Um app só.",
  highlight: ["13", "só."],
  items: [
    { label: "Mudança", icon: "truck" },
    { label: "Áreas Sociais", icon: "users" },
    { label: "Assembleias", icon: "vote" },
    { label: "Visitantes", icon: "face" },
    { label: "Comunicados", icon: "megaphone" },
    { label: "Enquetes", icon: "chart" },
    { label: "Encomendas", icon: "package" },
    { label: "Financeiro", icon: "wallet" },
    { label: "Ocorrências", icon: "shield" },
    { label: "Manutenções", icon: "wrench" },
    { label: "Funcionários", icon: "users" },
    { label: "Garagem", icon: "car" },
    { label: "Documentos", icon: "doc" },
  ] satisfies { label: string; icon: IconName }[],
};

export const STATS = {
  kicker: "Por que Prestare",
  headline: "Gestão que cabe no bolso do morador.",
  highlight: ["bolso"],
  items: [
    { value: 13, suffix: "", label: "módulos ativos", accentKey: "cyan" },
    { value: 100, suffix: "%", label: "digital, do boleto à ata", accentKey: "yellow" },
    { value: 24, suffix: "/7", label: "portaria monitorada", accentKey: "mint" },
  ],
};

export const OUTRO = {
  headline: "Seu condomínio merece isso.",
  highlight: ["isso."],
  cta: "Fale com a Prestare",
  stores: ["App Store", "Google Play"],
};
