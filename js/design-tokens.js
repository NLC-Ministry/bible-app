// ============================================================
// design-tokens.js — NLC satellite brand palette (shared)
// ============================================================

const NLC_DESIGN = {
  brand: "#04A9D2",
  brandHover: "#0396BA",
  brandActive: "#0284A3",
  brandSubtle: "rgba(4, 169, 210, 0.12)",
  brandMuted: "rgba(4, 169, 210, 0.08)",
  brandBorder: "rgba(4, 169, 210, 0.24)",
  success: "#66F78F",
  successForeground: "#1F8F52",
  successSubtle: "color-mix(in srgb, #66F78F 12%, transparent)",
  warning: "#FE7615",
  danger: "#FC365A",
  dangerSubtle: "color-mix(in srgb, #FC365A 12%, transparent)",
  muted: "#8A8A8A",
  white: "#FAFAFA",
  black: "#0F0F0F",
  progressFill: "#04A9D2",
  progressTrack: "color-mix(in srgb, #8A8A8A 18%, transparent)",
  iconDefault: "#0F0F0F",
  iconMuted: "#8A8A8A",
  iconBrand: "#04A9D2",
  iconAchievement: "#D97706",
};

/** Typography weights — matches Member Hub font-medium / font-normal */
const NLC_TYPE = {
  strong: 500,
  regular: 400,
};

/** Neutral shadow scale — matches Member Hub Tailwind shadow-sm/md/lg */
const NLC_SHADOW = {
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  upMd: "0 -4px 6px -1px rgb(0 0 0 / 0.1), 0 -2px 4px -2px rgb(0 0 0 / 0.1)",
  upLg: "0 -10px 15px -3px rgb(0 0 0 / 0.1), 0 -4px 6px -4px rgb(0 0 0 / 0.1)",
  none: "none",
};

const NLC_CHART = {
  brand: NLC_DESIGN.brand,
  brandFill: "rgba(4, 169, 210, 0.15)",
  brandStroke: "rgba(4, 169, 210, 0.85)",
  success: NLC_DESIGN.success,
  successForeground: NLC_DESIGN.successForeground,
  warning: NLC_DESIGN.warning,
  danger: NLC_DESIGN.danger,
  muted: NLC_DESIGN.muted,
};

/** Solid plan cover colors (no gradients) */
const NLC_PLAN_COVERS = [
  "#B8E8F5", // brand tint
  "#C8F5D8", // success tint
  "#FFE4CC", // warning tint
  "#D4E4F7", // cool neutral
  "#E8E0F5", // soft lavender neutral
];

/** Avatar / trail member colors — brand-adjacent solids */
const NLC_MEMBER_COLORS = [
  "#04A9D2",
  "#0396BA",
  "#66F78F",
  "#FE7615",
  "#5BB8D4",
  "#0284A3",
  "#8ED4EA",
  "#FC365A",
];

window.NLC_DESIGN = NLC_DESIGN;
window.NLC_TYPE = NLC_TYPE;
window.NLC_SHADOW = NLC_SHADOW;
window.NLC_CHART = NLC_CHART;
window.NLC_PLAN_COVERS = NLC_PLAN_COVERS;
window.NLC_MEMBER_COLORS = NLC_MEMBER_COLORS;
