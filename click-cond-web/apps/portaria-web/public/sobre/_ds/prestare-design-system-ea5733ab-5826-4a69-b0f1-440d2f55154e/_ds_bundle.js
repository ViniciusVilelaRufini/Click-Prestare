/* @ds-bundle: {"format":4,"namespace":"PrestareDesignSystem_ea5733","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"PRESTARE_ICONS","sourcePath":"components/core/Icon.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"IconChip","sourcePath":"components/core/IconChip.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"AccountTile","sourcePath":"components/data/AccountTile.jsx"},{"name":"AmountBanner","sourcePath":"components/data/AmountBanner.jsx"},{"name":"EventRow","sourcePath":"components/data/EventRow.jsx"},{"name":"ListRow","sourcePath":"components/data/ListRow.jsx"},{"name":"PinReveal","sourcePath":"components/data/PinReveal.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"FilterChipRow","sourcePath":"components/forms/FilterChipRow.jsx"},{"name":"MonthStrip","sourcePath":"components/forms/MonthStrip.jsx"},{"name":"SearchField","sourcePath":"components/forms/SearchField.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"AppBar","sourcePath":"components/layout/AppBar.jsx"},{"name":"EmptyState","sourcePath":"components/layout/EmptyState.jsx"},{"name":"HeroCard","sourcePath":"components/layout/HeroCard.jsx"},{"name":"PhoneFrame","sourcePath":"components/layout/PhoneFrame.jsx"},{"name":"SectionHeader","sourcePath":"components/layout/SectionHeader.jsx"},{"name":"TabBar","sourcePath":"components/layout/TabBar.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"39f3ecbb1cdb","components/core/Badge.jsx":"d9ca1b074839","components/core/Button.jsx":"0da0062d3003","components/core/Icon.jsx":"d7743f637f46","components/core/IconButton.jsx":"8e2b690da81d","components/core/IconChip.jsx":"4a6577d0a3a1","components/core/Logo.jsx":"9097da9e7df7","components/data/AccountTile.jsx":"4ea8dcc57716","components/data/AmountBanner.jsx":"378c42ab07f5","components/data/EventRow.jsx":"0f9c20cf4d3e","components/data/ListRow.jsx":"63f47df4f296","components/data/PinReveal.jsx":"a765159a97bb","components/data/StatCard.jsx":"7786d71a6dc2","components/forms/FilterChipRow.jsx":"7381f9648161","components/forms/MonthStrip.jsx":"8464ba16e4e4","components/forms/SearchField.jsx":"781f00f6d79d","components/forms/SegmentedControl.jsx":"2afd6553d35f","components/layout/AppBar.jsx":"f2e832cf7a4f","components/layout/EmptyState.jsx":"a3d3901af997","components/layout/HeroCard.jsx":"4639ca538771","components/layout/PhoneFrame.jsx":"1cf2b2b0524f","components/layout/SectionHeader.jsx":"465aeb10735b","components/layout/TabBar.jsx":"f2adab7ce099","ui_kits/prestare-app/App.kit.js":"4d3627addc78","ui_kits/prestare-app/CondominiumScreen.kit.js":"4ebfc81564f7","ui_kits/prestare-app/EventsScreen.kit.js":"d3604476659b","ui_kits/prestare-app/FinanceScreen.kit.js":"59d720eaff64","ui_kits/prestare-app/HomeScreen.kit.js":"471e7c637948","ui_kits/prestare-app/PackagesScreen.kit.js":"aa165e9920a7","ui_kits/prestare-app/Shell.kit.js":"0a6c10d5c43a","ui_kits/prestare-app/VisitorsScreen.kit.js":"58dd5a8a4b67","ui_kits/prestare-app/data.kit.js":"e83a4d60dbc9","ui_kits/prestare-redesign/RApp.kit.js":"6f3198d79f8e","ui_kits/prestare-redesign/RCondoScreen.kit.js":"31ebd7ce5bf0","ui_kits/prestare-redesign/RFinanceScreen.kit.js":"f9fcd059e13e","ui_kits/prestare-redesign/RHomeScreen.kit.js":"3c69c5305fd5","ui_kits/prestare-redesign/RShell.kit.js":"72a3329b4b4e","ui_kits/prestare-redesign/RVisitorsScreen.kit.js":"f1342b1ffc03","ui_kits/prestare-redesign/data.kit.js":"081c213ab5fb"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PrestareDesignSystem_ea5733 = window.PrestareDesignSystem_ea5733 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
const SIZES = {
  sm: 36,
  md: 48,
  lg: 56,
  xl: 64
};
function Avatar({
  src,
  name = "",
  size = "md",
  status,
  ring = false,
  square = false,
  style
}) {
  const d = SIZES[size] || SIZES.md;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  const statusColor = {
    onsite: "var(--status-onsite)",
    out: "var(--status-out)",
    pending: "var(--status-pending)"
  }[status];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      width: d,
      height: d,
      flex: "none",
      display: "inline-block",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      background: "var(--prestare-blue-100)",
      color: "var(--prestare-blue-600)",
      font: `var(--weight-bold) ${Math.round(d * 0.38)}px/1 var(--font-ui)`,
      borderRadius: square ? "var(--radius-thumb)" : "var(--radius-avatar)",
      boxShadow: ring ? "0 0 0 3px rgba(255,255,255,.45)" : "none"
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials), statusColor && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: Math.max(10, d * 0.22),
      height: Math.max(10, d * 0.22),
      borderRadius: "50%",
      background: statusColor,
      border: "2px solid var(--surface-card)"
    }
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/* Prestare iconography = Lucide (lucide.dev), 24x24 grid, 2px stroke, round caps/joins.
   Glyph markup is inlined from assets/icons/*.svg so <Icon> renders with currentColor
   and needs no network. Add a new glyph by copying its Lucide SVG inner markup here. */
const PRESTARE_ICONS = {
  "arrow-down-left": '<path d="M17 7 7 17"></path> <path d="M17 17H7V7"></path>',
  "arrow-right": '<path d="M5 12h14"></path> <path d="m12 5 7 7-7 7"></path>',
  "arrow-up-right": '<path d="M7 7h10v10"></path> <path d="M7 17 17 7"></path>',
  "bell": '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
  "building": '<path d="M12 10h.01"></path> <path d="M12 14h.01"></path> <path d="M12 6h.01"></path> <path d="M16 10h.01"></path> <path d="M16 14h.01"></path> <path d="M16 6h.01"></path> <path d="M8 10h.01"></path> <path d="M8 14h.01"></path> <path d="M8 6h.01"></path> <path d="M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"></path> <rect x="4" y="2" width="16" height="20" rx="2"></rect>',
  "building-complex": '<path d="M10 12h4"></path> <path d="M10 8h4"></path> <path d="M14 21v-3a2 2 0 0 0-4 0v3"></path> <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"></path> <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"></path>',
  "calendar": '<path d="M8 2v3"></path> <path d="M16 2v3"></path> <rect x="3" y="3" width="18" height="18" rx="2"></rect> <path d="M3 9h18"></path>',
  "calendar-days": '<path d="M8 2v3"></path> <path d="M16 2v3"></path> <rect x="3" y="3" width="18" height="18" rx="2"></rect> <path d="M3 9h18"></path> <path d="M8 13h.01"></path> <path d="M12 13h.01"></path> <path d="M16 13h.01"></path> <path d="M8 17h.01"></path> <path d="M12 17h.01"></path> <path d="M16 17h.01"></path>',
  "camera": '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"></path> <circle cx="12" cy="13" r="3"></circle>',
  "car": '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"></path> <circle cx="7" cy="17" r="2"></circle> <path d="M9 17h6"></path> <circle cx="17" cy="17" r="2"></circle>',
  "chart-column": '<path d="M3 3v16a2 2 0 0 0 2 2h16"></path> <path d="M18 17V9"></path> <path d="M13 17V5"></path> <path d="M8 17v-3"></path>',
  "check": '<path d="M20 6 9 17l-5-5"></path>',
  "chevron-down": '<path d="m6 9 6 6 6-6"></path>',
  "chevron-left": '<path d="m15 18-6-6 6-6"></path>',
  "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
  "circle-alert": '<circle cx="12" cy="12" r="10"></circle> <line x1="12" x2="12" y1="8" y2="12"></line> <line x1="12" x2="12.01" y1="16" y2="16"></line>',
  "circle-check": '<circle cx="12" cy="12" r="10"></circle> <path d="m16 9-5.5 5.5L8 12"></path>',
  "clock": '<circle cx="12" cy="12" r="10"></circle> <path d="M12 6v6l4 2"></path>',
  "contact-round": '<path d="M16 2v2"></path> <path d="M17.915 21a6 6 0 10-12 0"></path> <path d="M8 2v2"></path> <circle cx="12" cy="11" r="4"></circle> <rect x="3" y="3" width="18" height="18" rx="2"></rect>',
  "download": '<path d="M12 15V3"></path> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path> <path d="m7 10 5 5 5-5"></path>',
  "droplet": '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"></path>',
  "dumbbell": '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"></path> <path d="m2.5 21.5 1.4-1.4"></path> <path d="m20.1 3.9 1.4-1.4"></path> <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"></path> <path d="m9.6 14.4 4.8-4.8"></path>',
  "ellipsis": '<circle cx="12" cy="12" r="1"></circle> <circle cx="19" cy="12" r="1"></circle> <circle cx="5" cy="12" r="1"></circle>',
  "file-text": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path> <path d="M14 2v5a1 1 0 0 0 1 1h5"></path> <path d="M10 9H8"></path> <path d="M16 13H8"></path> <path d="M16 17H8"></path>',
  "house": '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  "id-card": '<path d="M13 19a4 4 0 00-8 0"></path> <path d="M16 10h2"></path> <path d="M16 14h2"></path> <circle cx="9" cy="12" r="3"></circle> <rect x="2" y="5" width="20" height="14" rx="2"></rect>',
  "key-round": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>',
  "link-2": '<path d="M9 17H7A5 5 0 0 1 7 7h2"></path> <path d="M15 7h2a5 5 0 1 1 0 10h-2"></path> <line x1="8" x2="16" y1="12" y2="12"></line>',
  "log-out": '<path d="m16 17 5-5-5-5"></path> <path d="M21 12H9"></path> <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>',
  "map-pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path> <circle cx="12" cy="10" r="3"></circle>',
  "megaphone": '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path> <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"></path> <path d="M8 6v8"></path>',
  "package": '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path> <path d="M12 22V12"></path> <polyline points="3.29 7 12 12 20.71 7"></polyline> <path d="m7.5 4.27 9 5.15"></path>',
  "pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path> <path d="m15 5 4 4"></path>',
  "phone": '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"></path>',
  "plus": '<path d="M5 12h14"></path> <path d="M12 5v14"></path>',
  "qr-code": '<rect width="5" height="5" x="3" y="3" rx="1"></rect> <rect width="5" height="5" x="16" y="3" rx="1"></rect> <rect width="5" height="5" x="3" y="16" rx="1"></rect> <path d="M21 16h-3a2 2 0 0 0-2 2v3"></path> <path d="M21 21v.01"></path> <path d="M12 7v3a2 2 0 0 1-2 2H7"></path> <path d="M3 12h.01"></path> <path d="M12 3h.01"></path> <path d="M12 16v.01"></path> <path d="M16 12h1"></path> <path d="M21 12v.01"></path> <path d="M12 21v-1"></path>',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path> <path d="M21 3v5h-5"></path> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path> <path d="M8 16H3v5"></path>',
  "search": '<path d="m21 21-4.34-4.34"></path> <circle cx="11" cy="11" r="8"></circle>',
  "settings": '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"></path> <circle cx="12" cy="12" r="3"></circle>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path> <path d="m9 12 2 2 4-4"></path>',
  "truck": '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path> <path d="M15 18H9"></path> <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path> <circle cx="17" cy="18" r="2"></circle> <circle cx="7" cy="18" r="2"></circle>',
  "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path> <circle cx="9" cy="7" r="4"></circle> <line x1="19" x2="19" y1="8" y2="14"></line> <line x1="22" x2="16" y1="11" y2="11"></line>',
  "user-round-plus": '<path d="M2 21a8 8 0 0 1 13.292-6"></path> <circle cx="10" cy="8" r="5"></circle> <path d="M19 16v6"></path> <path d="M22 19h-6"></path>',
  "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path> <path d="M16 3.128a4 4 0 0 1 0 7.744"></path> <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path> <circle cx="9" cy="7" r="4"></circle>',
  "users-round": '<path d="M18 21a8 8 0 0 0-16 0"></path> <circle cx="10" cy="8" r="5"></circle> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"></path>',
  "wallet": '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path> <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path>',
  "wifi": '<path d="M12 20h.01"></path> <path d="M2 8.82a15 15 0 0 1 20 0"></path> <path d="M5 12.859a10 10 0 0 1 14 0"></path> <path d="M8.5 16.429a5 5 0 0 1 7 0"></path>',
  "x": '<path d="M18 6 6 18"></path> <path d="m6 6 12 12"></path>',
  "zap": '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"></path>'
};
function Icon({
  name,
  size = 22,
  strokeWidth = 2,
  color,
  title,
  style,
  className
}) {
  const glyph = PRESTARE_ICONS[name];
  return /*#__PURE__*/React.createElement("svg", {
    className: className,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: title ? "img" : "presentation",
    "aria-hidden": title ? undefined : true,
    style: {
      display: "block",
      flex: "none",
      ...style
    },
    dangerouslySetInnerHTML: {
      __html: (title ? `<title>${title}</title>` : "") + (glyph || "")
    }
  });
}
Object.assign(__ds_scope, { PRESTARE_ICONS, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const TONES = {
  neutral: {
    bg: "var(--neutral-100)",
    fg: "var(--text-muted)"
  },
  brand: {
    bg: "var(--prestare-blue-50)",
    fg: "var(--prestare-blue-600)"
  },
  success: {
    bg: "var(--green-100)",
    fg: "var(--green-600)"
  },
  danger: {
    bg: "var(--red-100)",
    fg: "var(--red-600)"
  },
  warning: {
    bg: "var(--amber-100)",
    fg: "var(--amber-600)"
  },
  violet: {
    bg: "var(--violet-100)",
    fg: "var(--violet-500)"
  },
  outline: {
    bg: "var(--surface-card)",
    fg: "var(--text-muted)",
    bd: "var(--border-subtle)"
  }
};
function Badge({
  children,
  tone = "neutral",
  icon,
  uppercase = false,
  dot = false,
  style
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      height: 22,
      padding: "0 8px",
      background: t.bg,
      color: t.fg,
      border: `1px solid ${t.bd || "transparent"}`,
      borderRadius: "var(--radius-xs)",
      font: uppercase ? "var(--type-overline)" : "var(--type-caption)",
      letterSpacing: uppercase ? "var(--text-overline-ls)" : "0",
      textTransform: uppercase ? "uppercase" : "none",
      whiteSpace: "nowrap",
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "currentColor"
    }
  }), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 13,
    strokeWidth: 2.4
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const SIZES = {
  sm: {
    h: 36,
    px: 14,
    gap: 6,
    font: "var(--type-caption)",
    icon: 16,
    radius: "var(--radius-sm)"
  },
  md: {
    h: 44,
    px: 18,
    gap: 8,
    font: "var(--type-body-strong)",
    icon: 18,
    radius: "var(--radius-md)"
  },
  lg: {
    h: 52,
    px: 22,
    gap: 10,
    font: "var(--type-h3)",
    icon: 20,
    radius: "var(--radius-lg)"
  }
};
const VARIANTS = {
  primary: {
    bg: "var(--prestare-blue-500)",
    fg: "var(--text-on-brand)",
    bd: "transparent",
    sh: "var(--glow-brand)"
  },
  secondary: {
    bg: "var(--prestare-blue-50)",
    fg: "var(--prestare-blue-600)",
    bd: "transparent",
    sh: "none"
  },
  outline: {
    bg: "var(--surface-card)",
    fg: "var(--text-strong)",
    bd: "var(--border-subtle)",
    sh: "var(--shadow-row)"
  },
  ghost: {
    bg: "transparent",
    fg: "var(--text-muted)",
    bd: "transparent",
    sh: "none"
  },
  danger: {
    bg: "var(--red-500)",
    fg: "var(--text-on-brand)",
    bd: "transparent",
    sh: "var(--glow-danger)"
  }
};
function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  fullWidth = false,
  disabled = false,
  pill = false,
  onClick,
  type = "button",
  style
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    className: `ps-pressable ps-btn-${variant}`,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.h,
      padding: `0 ${s.px}px`,
      width: fullWidth ? "100%" : "auto",
      font: s.font,
      color: v.fg,
      background: v.bg,
      border: `1px solid ${v.bd}`,
      borderRadius: pill ? "var(--radius-pill)" : s.radius,
      boxShadow: disabled ? "none" : v.sh,
      whiteSpace: "nowrap",
      ...style
    }
  }, iconLeft && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconLeft,
    size: s.icon
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.icon
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
const SIZES = {
  sm: 36,
  md: 44,
  lg: 48
};
function IconButton({
  icon,
  label,
  size = "md",
  tone = "neutral",
  badge,
  onClick,
  disabled = false,
  style
}) {
  const d = SIZES[size] || SIZES.md;
  const tones = {
    neutral: {
      bg: "var(--neutral-100)",
      fg: "var(--icon-default)"
    },
    brand: {
      bg: "var(--prestare-blue-100)",
      fg: "var(--icon-brand)"
    },
    filled: {
      bg: "var(--prestare-blue-500)",
      fg: "var(--icon-on-brand)"
    },
    onBrand: {
      bg: "rgba(255,255,255,.18)",
      fg: "var(--icon-on-brand)"
    },
    plain: {
      bg: "transparent",
      fg: "var(--icon-default)"
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    disabled: disabled,
    "aria-label": label,
    className: `ps-pressable ${tone === "onBrand" ? "ps-iconbtn-on-brand" : "ps-iconbtn"}`,
    style: {
      position: "relative",
      width: d,
      height: d,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: 0,
      borderRadius: "var(--radius-pill)",
      background: t.bg,
      color: t.fg,
      boxShadow: tone === "filled" ? "var(--glow-brand)" : "none",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === "sm" ? 18 : 20
  }), badge != null && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -2,
      right: -2,
      minWidth: 20,
      height: 20,
      padding: "0 5px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--red-500)",
      color: "var(--neutral-0)",
      font: "var(--weight-bold) 11px/1 var(--font-ui)",
      borderRadius: "var(--radius-pill)",
      border: "2px solid var(--surface-card)"
    }
  }, badge));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/IconChip.jsx
try { (() => {
const TONES = {
  brand: {
    bg: "var(--prestare-blue-100)",
    fg: "var(--prestare-blue-500)"
  },
  success: {
    bg: "var(--green-100)",
    fg: "var(--green-600)"
  },
  danger: {
    bg: "var(--red-100)",
    fg: "var(--red-600)"
  },
  warning: {
    bg: "var(--amber-100)",
    fg: "var(--amber-600)"
  },
  violet: {
    bg: "var(--violet-100)",
    fg: "var(--violet-500)"
  },
  cyan: {
    bg: "var(--cyan-100)",
    fg: "var(--cyan-500)"
  },
  neutral: {
    bg: "var(--neutral-100)",
    fg: "var(--icon-default)"
  },
  onBrand: {
    bg: "rgba(255,255,255,.18)",
    fg: "var(--icon-on-brand)"
  }
};
const SIZES = {
  sm: 34,
  md: 44,
  lg: 52
};
function IconChip({
  icon,
  tone = "brand",
  size = "md",
  style
}) {
  const t = TONES[tone] || TONES.brand;
  const d = SIZES[size] || SIZES.md;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: t.bg,
      color: t.fg,
      borderRadius: d >= 44 ? "var(--radius-md)" : "var(--radius-sm)",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: Math.round(d * 0.48)
  }));
}
Object.assign(__ds_scope, { IconChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconChip.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
/** The Prestare app mark. The supplied source contains only the store icon (assets/logo/
 *  prestare-app-icon-512.png) — no standalone wordmark file — so the wordmark here is set
 *  in type (Poppins 800), never redrawn. */
function Logo({
  variant = "mark",
  size = 40,
  src = "../../assets/logo/prestare-app-icon-512.png",
  style
}) {
  const mark = /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "Prestare",
    width: size,
    height: size,
    style: {
      display: "block",
      borderRadius: Math.round(size * 0.22),
      flex: "none"
    }
  });
  if (variant === "mark") return /*#__PURE__*/React.createElement("span", {
    style: style
  }, mark);
  if (variant === "wordmark") {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        font: `var(--weight-extrabold) ${Math.round(size * 0.62)}px/1 var(--font-display)`,
        letterSpacing: ".04em",
        color: "var(--prestare-blue-900)",
        ...style
      }
    }, "PRESTARE");
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: Math.round(size * 0.28),
      ...style
    }
  }, mark, /*#__PURE__*/React.createElement("span", {
    style: {
      font: `var(--weight-extrabold) ${Math.round(size * 0.52)}px/1 var(--font-display)`,
      letterSpacing: ".04em",
      color: "var(--prestare-blue-900)"
    }
  }, "PRESTARE"));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/data/AccountTile.jsx
try { (() => {
function AccountTile({
  icon,
  label,
  pendingCount = 0,
  tone = "violet",
  onClick,
  style
}) {
  const pending = pendingCount > 0;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    className: "ps-pressable ps-tile",
    style: {
      position: "relative",
      display: "grid",
      gap: 34,
      alignContent: "space-between",
      padding: "var(--pad-card)",
      minHeight: 140,
      minWidth: 0,
      background: pending ? "var(--red-50)" : "var(--surface-row)",
      border: `1px solid ${pending ? "var(--red-100)" : "var(--border-row)"}`,
      borderRadius: "var(--radius-xl)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconChip, {
    icon: icon,
    tone: pending ? tone : tone
  }), pending && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      height: 26,
      padding: "0 9px",
      background: "var(--red-100)",
      color: "var(--red-600)",
      borderRadius: "var(--radius-pill)",
      font: "var(--weight-bold) 13px/1 var(--font-ui)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "circle-alert",
    size: 14,
    strokeWidth: 2.4
  }), pendingCount)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 3,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: pending ? "var(--text-danger)" : "var(--text-faint)"
    }
  }, pending ? `${pendingCount} pendente${pendingCount > 1 ? "s" : ""}` : "Nenhuma pendência")));
}
Object.assign(__ds_scope, { AccountTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/AccountTile.jsx", error: String((e && e.message) || e) }); }

// components/data/AmountBanner.jsx
try { (() => {
function AmountBanner({
  label,
  amount,
  currency = "BRL",
  caption,
  tone = "brand",
  style
}) {
  const danger = tone === "danger";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 6,
      padding: "20px var(--pad-card)",
      background: danger ? "linear-gradient(118deg,#e5484d 0%,#cf3b40 100%)" : "var(--gradient-hero)",
      borderRadius: "var(--radius-xl)",
      boxShadow: danger ? "var(--glow-danger)" : "var(--glow-brand)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-on-brand-muted)",
      fontWeight: "var(--weight-medium)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-amount)",
      color: "var(--text-on-brand)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: "var(--weight-bold)",
      marginRight: 8,
      verticalAlign: "2px"
    }
  }, currency), amount), caption && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, caption));
}
Object.assign(__ds_scope, { AmountBanner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/AmountBanner.jsx", error: String((e && e.message) || e) }); }

// components/data/EventRow.jsx
try { (() => {
function EventRow({
  name,
  direction = "in",
  timestamp,
  role = "Visitante",
  onClick,
  style
}) {
  const isIn = direction === "in";
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    className: "ps-pressable ps-row",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 16px",
      minWidth: 0,
      background: "transparent",
      borderBottom: "1px solid var(--border-row)",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconChip, {
    icon: isIn ? "arrow-down-left" : "arrow-up-right",
    tone: isIn ? "brand" : "violet",
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 3,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: isIn ? "var(--status-in)" : "var(--status-out)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: isIn ? "var(--status-in)" : "var(--status-out)",
      font: "var(--type-body-strong)",
      fontSize: 13
    }
  }, isIn ? "Entrou" : "Saiu"), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, timestamp))), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "outline"
  }, role), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 18,
    color: "var(--icon-muted)"
  }));
}
Object.assign(__ds_scope, { EventRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/EventRow.jsx", error: String((e && e.message) || e) }); }

// components/data/ListRow.jsx
try { (() => {
function ListRow({
  leading,
  title,
  subtitle,
  overline,
  meta,
  trailing,
  showChevron = true,
  tone = "card",
  onClick,
  style
}) {
  const backgrounds = {
    card: "var(--surface-card)",
    sunken: "var(--surface-row)",
    tint: "var(--surface-tint)"
  };
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    className: "ps-pressable ps-row",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 16px",
      minWidth: 0,
      background: backgrounds[tone] || backgrounds.card,
      border: "1px solid var(--border-row)",
      borderRadius: "var(--radius-lg)",
      boxShadow: tone === "card" ? "var(--shadow-row)" : "none",
      ...style
    }
  }, leading, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      flex: 1,
      minWidth: 0
    }
  }, overline && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-overline)",
      letterSpacing: "var(--text-overline-ls)",
      textTransform: "uppercase",
      color: "var(--text-link)"
    }
  }, overline), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: "var(--text-muted)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, subtitle), meta && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginTop: 2
    }
  }, meta)), trailing, showChevron && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 20,
    color: "var(--icon-muted)"
  }));
}
Object.assign(__ds_scope, { ListRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ListRow.jsx", error: String((e && e.message) || e) }); }

// components/data/PinReveal.jsx
try { (() => {
function PinReveal({
  pin,
  label = "PIN",
  copied = false,
  onCopy,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onCopy,
    className: "ps-pressable",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      height: 30,
      padding: "0 10px",
      background: "var(--prestare-blue-50)",
      border: "1px solid var(--prestare-blue-100)",
      borderRadius: "var(--radius-sm)",
      color: "var(--prestare-blue-600)",
      font: "var(--weight-bold) 14px/1 var(--font-ui)",
      letterSpacing: ".04em",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: copied ? "check" : "key-round",
    size: 15,
    strokeWidth: 2.4
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-overline)",
      letterSpacing: "var(--text-overline-ls)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: "tabular-nums"
    }
  }, pin));
}
Object.assign(__ds_scope, { PinReveal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/PinReveal.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
const TINTS = {
  brand: {
    bg: "var(--prestare-blue-50)",
    bd: "var(--prestare-blue-100)",
    fg: "var(--prestare-blue-500)"
  },
  success: {
    bg: "var(--green-50)",
    bd: "var(--green-100)",
    fg: "var(--green-600)"
  },
  danger: {
    bg: "var(--red-50)",
    bd: "var(--red-100)",
    fg: "var(--red-600)"
  },
  warning: {
    bg: "var(--amber-50)",
    bd: "var(--amber-100)",
    fg: "var(--amber-600)"
  },
  neutral: {
    bg: "var(--surface-card)",
    bd: "var(--border-subtle)",
    fg: "var(--text-strong)"
  }
};
function StatCard({
  icon,
  value,
  label,
  hint,
  tone = "brand",
  onClick,
  style
}) {
  const t = TINTS[tone] || TINTS.brand;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    className: onClick ? "ps-pressable ps-tile" : undefined,
    style: {
      display: "grid",
      gap: 10,
      padding: "var(--pad-card)",
      minWidth: 0,
      background: t.bg,
      border: `1px solid ${t.bd}`,
      borderRadius: "var(--radius-xl)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconChip, {
    icon: icon,
    tone: tone,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h1)",
      color: t.fg,
      fontSize: 26,
      lineHeight: "28px"
    }
  }, value)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-strong)",
      color: "var(--text-strong)"
    }
  }, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, hint)));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/forms/FilterChipRow.jsx
try { (() => {
function FilterChipRow({
  items = [],
  value,
  onChange,
  variant = "soft",
  style
}) {
  const solid = variant === "solid";
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "flex",
      gap: 8,
      overflowX: "auto",
      scrollbarWidth: "none",
      padding: solid ? 4 : 0,
      background: solid ? "var(--surface-row)" : "transparent",
      borderRadius: solid ? "var(--radius-lg)" : 0,
      ...style
    }
  }, items.map(it => {
    const active = it.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(it.id),
      className: "ps-pressable ps-chip",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 44,
        padding: "0 16px",
        flex: solid ? "1 1 0" : "none",
        justifyContent: "center",
        font: active ? "var(--type-body-strong)" : "var(--type-body)",
        color: solid ? active ? "var(--text-on-brand)" : "var(--text-muted)" : active ? "var(--prestare-blue-600)" : "var(--text-muted)",
        background: solid ? active ? "var(--prestare-blue-500)" : "transparent" : active ? "var(--prestare-blue-50)" : "var(--surface-row)",
        border: `1px solid ${!solid && active ? "var(--prestare-blue-200)" : "transparent"}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: solid && active ? "var(--glow-brand)" : "none",
        whiteSpace: "nowrap"
      }
    }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 17
    }), it.label, it.count != null ? ` (${it.count})` : "");
  }));
}
Object.assign(__ds_scope, { FilterChipRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FilterChipRow.jsx", error: String((e && e.message) || e) }); }

// components/forms/MonthStrip.jsx
try { (() => {
function MonthStrip({
  months = [],
  value,
  onChange,
  onPrev,
  onNext,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: 6,
      background: "var(--surface-row)",
      borderRadius: "var(--radius-lg)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "M\xEAs anterior",
    onClick: onPrev,
    className: "ps-pressable",
    style: {
      border: 0,
      background: "transparent",
      color: "var(--icon-muted)",
      width: 36,
      height: 44,
      display: "grid",
      placeItems: "center"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-left",
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flex: 1,
      gap: 4
    }
  }, months.map(m => {
    const active = m.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: m.id,
      onClick: () => onChange && onChange(m.id),
      className: "ps-pressable",
      style: {
        flex: "1 1 0",
        border: 0,
        borderRadius: "var(--radius-md)",
        padding: "6px 0",
        background: active ? "var(--prestare-blue-500)" : "transparent",
        color: active ? "var(--text-on-brand)" : "var(--text-muted)",
        display: "grid",
        gap: 1,
        justifyItems: "center",
        boxShadow: active ? "var(--glow-brand)" : "none"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-overline)",
        letterSpacing: "var(--text-overline-ls)",
        textTransform: "uppercase",
        fontSize: 12
      }
    }, m.label), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        fontSize: 11,
        opacity: active ? .85 : .7
      }
    }, m.year));
  })), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Pr\xF3ximo m\xEAs",
    onClick: onNext,
    className: "ps-pressable",
    style: {
      border: 0,
      background: "transparent",
      color: "var(--icon-muted)",
      width: 36,
      height: 44,
      display: "grid",
      placeItems: "center"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 20
  })));
}
Object.assign(__ds_scope, { MonthStrip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/MonthStrip.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchField.jsx
try { (() => {
function SearchField({
  value,
  onChange,
  placeholder = "Buscar",
  onClear,
  autoFocus,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "ps-field",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: 52,
      padding: "0 16px",
      background: "var(--surface-row)",
      border: "1px solid transparent",
      borderRadius: "var(--radius-lg)",
      transition: "var(--transition-interactive)",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 20,
    color: "var(--icon-muted)"
  }), /*#__PURE__*/React.createElement("input", {
    value: value,
    placeholder: placeholder,
    autoFocus: autoFocus,
    onChange: e => onChange && onChange(e.target.value)
  }), value ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Limpar busca",
    onClick: onClear,
    className: "ps-pressable",
    style: {
      border: 0,
      background: "var(--neutral-200)",
      color: "var(--icon-default)",
      width: 22,
      height: 22,
      borderRadius: "50%",
      display: "grid",
      placeItems: "center",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 13,
    strokeWidth: 2.6
  })) : null);
}
Object.assign(__ds_scope, { SearchField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchField.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function SegmentedControl({
  items = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "flex",
      padding: 4,
      gap: 4,
      background: "var(--surface-row)",
      borderRadius: "var(--radius-lg)",
      ...style
    }
  }, items.map(it => {
    const active = it.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(it.id),
      className: "ps-pressable",
      style: {
        flex: "1 1 0",
        height: 44,
        border: 0,
        borderRadius: "var(--radius-md)",
        background: active ? "var(--prestare-blue-500)" : "transparent",
        color: active ? "var(--text-on-brand)" : "var(--text-muted)",
        font: "var(--type-overline)",
        letterSpacing: "var(--text-overline-ls)",
        textTransform: "uppercase",
        fontSize: 13,
        boxShadow: active ? "var(--glow-brand)" : "none"
      }
    }, it.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/layout/AppBar.jsx
try { (() => {
function AppBar({
  title,
  eyebrow,
  onBack,
  actions = [],
  align = "left",
  style
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      minHeight: "var(--appbar-height)",
      padding: "4px var(--gutter-screen)",
      background: "var(--surface-app)",
      ...style
    }
  }, onBack && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "chevron-left",
    label: "Voltar",
    onClick: onBack
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 1,
      flex: 1,
      minWidth: 0,
      textAlign: align === "center" ? "center" : "left"
    }
  }, eyebrow && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: "var(--text-faint)"
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, actions.map(a => /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    key: a.icon,
    icon: a.icon,
    label: a.label,
    badge: a.badge,
    tone: a.tone || "neutral",
    onClick: a.onClick
  }))));
}
Object.assign(__ds_scope, { AppBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/AppBar.jsx", error: String((e && e.message) || e) }); }

// components/layout/EmptyState.jsx
try { (() => {
function EmptyState({
  icon = "search",
  title,
  description,
  actionLabel,
  onAction,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 12,
      justifyItems: "center",
      textAlign: "center",
      padding: "40px 24px",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconChip, {
    icon: icon,
    tone: "neutral",
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 4,
      maxWidth: 280
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)"
    }
  }, title), description && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: "var(--text-muted)",
      textWrap: "pretty"
    }
  }, description)), actionLabel && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "secondary",
    size: "sm",
    onClick: onAction
  }, actionLabel));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/layout/HeroCard.jsx
try { (() => {
function HeroCard({
  greeting,
  name,
  meta,
  metaIcon = "calendar",
  avatarSrc,
  actions = [],
  stats,
  style
}) {
  const tight = actions.length > 2;
  const metaPill = meta ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      justifySelf: "start",
      maxWidth: "100%",
      height: 26,
      padding: "0 11px",
      background: "rgba(255,255,255,.18)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      borderRadius: "var(--radius-pill)",
      font: "var(--type-caption)",
      color: "var(--text-on-brand)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: metaIcon,
    size: 13,
    strokeWidth: 2.2
  }), meta) : null;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 16,
      padding: "var(--pad-card)",
      background: "var(--gradient-hero)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--glow-brand)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      minWidth: 0
    }
  }, avatarSrc !== undefined && /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    src: avatarSrc,
    name: name,
    size: "md",
    ring: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-on-brand)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, greeting && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: "var(--weight-regular)",
      opacity: .78
    }
  }, greeting, " "), name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: tight ? 6 : 8,
      flex: "none"
    }
  }, actions.map(a => /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    key: a.icon,
    icon: a.icon,
    label: a.label,
    badge: a.badge,
    tone: "onBrand",
    onClick: a.onClick
  })))), metaPill, stats && stats.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "stretch",
      gap: 0,
      borderTop: "1px solid rgba(255,255,255,.22)",
      paddingTop: 14
    }
  }, stats.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    style: {
      flex: "1 1 0",
      display: "flex",
      alignItems: "center",
      gap: 12,
      minWidth: 0,
      paddingLeft: i ? 16 : 0,
      borderLeft: i ? "1px solid rgba(255,255,255,.22)" : "none"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: s.icon,
    size: 26,
    color: "var(--icon-on-brand)",
    strokeWidth: 1.8
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid",
      gap: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-on-brand)"
    }
  }, s.value), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: "var(--text-on-brand-muted)"
    }
  }, s.label))))));
}
Object.assign(__ds_scope, { HeroCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/HeroCard.jsx", error: String((e && e.message) || e) }); }

// components/layout/PhoneFrame.jsx
try { (() => {
/** Presentation-only device shell for showing Prestare screens in specimens and kits. */
function PhoneFrame({
  children,
  time = "15:20",
  width = 390,
  height = 844,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      position: "relative",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface-app)",
      borderRadius: 44,
      overflow: "hidden",
      boxShadow: "var(--shadow-floating)",
      border: "1px solid var(--border-subtle)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      height: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 26px",
      font: "var(--weight-bold) 15px/1 var(--font-ui)",
      color: "var(--text-strong)"
    }
  }, /*#__PURE__*/React.createElement("span", null, time), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      font: "var(--weight-semibold) 13px/1 var(--font-ui)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "flex-end",
      gap: 2
    }
  }, [6, 9, 12].map(h => /*#__PURE__*/React.createElement("span", {
    key: h,
    style: {
      width: 3,
      height: h,
      borderRadius: 1,
      background: "var(--text-strong)"
    }
  }))), "5G", /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 13,
      borderRadius: 4,
      border: "1.5px solid var(--text-strong)",
      padding: 1.5,
      display: "inline-flex"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      borderRadius: 2,
      background: "var(--text-strong)"
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, children));
}
Object.assign(__ds_scope, { PhoneFrame });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/PhoneFrame.jsx", error: String((e && e.message) || e) }); }

// components/layout/SectionHeader.jsx
try { (() => {
function SectionHeader({
  title,
  count,
  icon,
  actionLabel,
  onAction,
  size = "md",
  style
}) {
  const big = size === "lg";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 10,
      minWidth: 0,
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: "center",
      color: "var(--icon-brand)",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: big ? "var(--type-h1)" : "var(--type-h2)",
      color: "var(--text-strong)"
    }
  }, title), count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-sub)",
      color: "var(--text-faint)",
      flex: 1
    }
  }, count), count == null && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), actionLabel && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    className: "ps-pressable",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      border: 0,
      background: "transparent",
      color: "var(--text-link)",
      font: "var(--type-body-strong)",
      padding: "6px 0"
    }
  }, actionLabel, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 17
  })));
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/layout/TabBar.jsx
try { (() => {
function TabBar({
  items = [],
  value,
  onChange,
  centerIndex = 2,
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "var(--tabbar-height)",
      padding: "0 6px",
      margin: "0 12px 12px",
      background: "rgba(255,255,255,.86)",
      backdropFilter: "blur(18px)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-floating)",
      ...style
    }
  }, items.map((it, i) => {
    const active = it.id === value;
    if (i === centerIndex) {
      return /*#__PURE__*/React.createElement("button", {
        key: it.id,
        onClick: () => onChange && onChange(it.id),
        "aria-label": it.label,
        className: "ps-pressable",
        style: {
          width: 58,
          height: 58,
          border: "4px solid var(--surface-card)",
          borderRadius: "var(--radius-pill)",
          background: "var(--prestare-blue-500)",
          color: "var(--icon-on-brand)",
          display: "grid",
          placeItems: "center",
          marginTop: -18,
          boxShadow: "var(--glow-brand-strong)",
          flex: "none"
        }
      }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
        name: it.icon,
        size: 25
      }));
    }
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      onClick: () => onChange && onChange(it.id),
      className: "ps-pressable ps-tab",
      style: {
        flex: "1 1 0",
        minWidth: 0,
        border: 0,
        background: "transparent",
        padding: "6px 2px",
        display: "grid",
        gap: 3,
        justifyItems: "center",
        color: active ? "var(--prestare-blue-500)" : "var(--neutral-600)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "ps-tab-pill",
      style: {
        display: "grid",
        placeItems: "center",
        width: 46,
        height: 30,
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--prestare-blue-100)" : "transparent",
        transition: "var(--transition-interactive)"
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 21,
      strokeWidth: active ? 2.3 : 2
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        font: active ? "var(--type-body-strong)" : "var(--type-caption)",
        fontSize: 11.5,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: "100%"
      }
    }, it.label));
  }));
}
Object.assign(__ds_scope, { TabBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/TabBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/App.kit.js
try { (() => {
function PrestareApp() {
  const {
    PhoneFrame
  } = window.PrestareDesignSystem_ea5733;
  const {
    FloatingNav,
    HomeScreen,
    CondominiumScreen,
    EventsScreen,
    VisitorsScreen,
    FinanceScreen,
    PackagesScreen
  } = window;
  const [tab, setTab] = React.useState("inicio");
  const [route, setRoute] = React.useState({
    name: "home"
  });
  const go = t => {
    setTab(t);
    setRoute({
      name: t === "inicio" ? "home" : t
    });
  };
  let screen;
  if (route.name === "condo") screen = /*#__PURE__*/React.createElement(CondominiumScreen, {
    condoId: route.id,
    onBack: () => go("inicio")
  });else if (route.name === "events") screen = /*#__PURE__*/React.createElement(EventsScreen, {
    onBack: () => go("inicio")
  });else if (route.name === "visitantes") screen = /*#__PURE__*/React.createElement(VisitorsScreen, null);else if (route.name === "financeiro") screen = /*#__PURE__*/React.createElement(FinanceScreen, null);else if (route.name === "encomendas") screen = /*#__PURE__*/React.createElement(PackagesScreen, null);else if (route.name === "condominios") screen = /*#__PURE__*/React.createElement(CondominiumScreen, {
    condoId: "demo",
    onBack: () => go("inicio")
  });else screen = /*#__PURE__*/React.createElement(HomeScreen, {
    onTab: go,
    onOpenCondo: id => {
      setTab("condominios");
      setRoute({
        name: "condo",
        id
      });
    },
    onSeeAllEvents: () => setRoute({
      name: "events"
    })
  });
  return /*#__PURE__*/React.createElement(PhoneFrame, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, screen, /*#__PURE__*/React.createElement(FloatingNav, {
    tab: tab,
    onChange: go
  })));
}
window.PrestareApp = PrestareApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/App.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/CondominiumScreen.kit.js
try { (() => {
function CondominiumScreen({
  condoId,
  onBack
}) {
  const {
    AppBar,
    HeroCard,
    SectionHeader,
    ListRow,
    IconChip,
    Badge,
    SearchField
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody,
    CardStack
  } = window;
  const condo = window.CONDOS.find(c => c.id === condoId) || window.CONDOS[0];
  const [q, setQ] = React.useState("");
  const modules = window.MODULES.filter(m => m.label.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: condo.name,
    eyebrow: "Ol\xE1 Vinicius",
    onBack: onBack,
    actions: [{
      icon: "car",
      label: "Veículos"
    }, {
      icon: "settings",
      label: "Ajustes"
    }]
  }), /*#__PURE__*/React.createElement(ScreenBody, {
    style: {
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(HeroCard, {
    name: condo.name,
    meta: condo.unit,
    metaIcon: "map-pin",
    avatarSrc: condo.photo || undefined,
    actions: [{
      icon: "file-text",
      label: "Documentos"
    }],
    stats: [{
      icon: "package",
      value: condo.encomendas,
      label: "Encomendas"
    }, {
      icon: "contact-round",
      value: condo.visitas,
      label: "Visitas hoje"
    }]
  }), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    size: "lg",
    title: "Gerenciar",
    count: `${condo.modules} módulos`
  }), /*#__PURE__*/React.createElement(SearchField, {
    value: q,
    onChange: setQ,
    onClear: () => setQ(""),
    placeholder: "Buscar m\xF3dulo"
  }), /*#__PURE__*/React.createElement(CardStack, null, modules.map((m, i, a) => /*#__PURE__*/React.createElement(ListRow, {
    key: m.id,
    leading: /*#__PURE__*/React.createElement(IconChip, {
      icon: m.icon
    }),
    title: m.label,
    tone: "card",
    trailing: m.badge ? /*#__PURE__*/React.createElement(Badge, {
      tone: "brand"
    }, m.badge) : null,
    style: {
      border: "none",
      borderRadius: 0,
      boxShadow: "none",
      borderBottom: i === a.length - 1 ? "none" : "1px solid var(--border-row)"
    }
  }))))));
}
Object.assign(window, {
  CondominiumScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/CondominiumScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/EventsScreen.kit.js
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function EventsScreen({
  onBack
}) {
  const {
    AppBar,
    EventRow,
    FilterChipRow,
    EmptyState
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody,
    CardStack
  } = window;
  const [f, setF] = React.useState("todos");
  const list = window.EVENTS.filter(e => f === "todos" || (f === "in" ? e.direction === "in" : e.direction === "out"));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Meus eventos",
    onBack: onBack,
    actions: [{
      icon: "download",
      label: "Exportar"
    }]
  }), /*#__PURE__*/React.createElement(ScreenBody, {
    style: {
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(FilterChipRow, {
    value: f,
    onChange: setF,
    items: [{
      id: "todos",
      label: "Todos",
      count: 6
    }, {
      id: "in",
      label: "Entradas",
      count: 4
    }, {
      id: "out",
      label: "Saídas",
      count: 2
    }]
  }), list.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "clock",
    title: "Nenhum evento",
    description: "Os acessos aparecem aqui em tempo real."
  }) : /*#__PURE__*/React.createElement(CardStack, null, list.map((e, i, a) => /*#__PURE__*/React.createElement(EventRow, _extends({
    key: e.id
  }, e, {
    style: i === a.length - 1 ? {
      borderBottom: "none"
    } : undefined
  }))))));
}
Object.assign(window, {
  EventsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/EventsScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/FinanceScreen.kit.js
try { (() => {
function FinanceScreen() {
  const {
    AppBar,
    SegmentedControl,
    MonthStrip,
    AmountBanner,
    SectionHeader,
    AccountTile
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody
  } = window;
  const [scope, setScope] = React.useState("meu");
  const [mes, setMes] = React.useState("set");
  const pendentes = window.ACCOUNTS.filter(a => a.pending > 0).length;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Financeiro",
    align: "center",
    actions: [{
      icon: "download",
      label: "Baixar extrato"
    }]
  }), /*#__PURE__*/React.createElement(ScreenBody, {
    style: {
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    value: scope,
    onChange: setScope,
    items: [{
      id: "meu",
      label: "Meu financeiro"
    }, {
      id: "cond",
      label: "Condomínio"
    }]
  }), /*#__PURE__*/React.createElement(MonthStrip, {
    value: mes,
    onChange: setMes,
    months: window.MONTHS
  }), /*#__PURE__*/React.createElement(AmountBanner, {
    label: "Total pendente",
    amount: scope === "meu" ? "1.258,19" : "48.930,00",
    caption: scope === "meu" ? "2 contas em aberto · vence 20/09" : "Prestação de contas de setembro"
  }), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    icon: "wallet",
    title: "Contas",
    count: `${pendentes} pendente${pendentes > 1 ? "s" : ""}`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, window.ACCOUNTS.map(a => /*#__PURE__*/React.createElement(AccountTile, {
    key: a.id,
    icon: a.icon,
    label: a.label,
    tone: a.tone,
    pendingCount: a.pending
  }))))));
}
Object.assign(window, {
  FinanceScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/FinanceScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/HomeScreen.kit.js
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function HomeScreen({
  onOpenCondo,
  onSeeAllEvents,
  onTab
}) {
  const {
    HeroCard,
    SectionHeader,
    StatCard,
    ListRow,
    EventRow,
    Avatar,
    IconChip,
    Button
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody,
    CardStack
  } = window;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px var(--gutter-screen) 20px"
    }
  }, /*#__PURE__*/React.createElement(HeroCard, {
    greeting: "Ol\xE1",
    name: "VINICIUS",
    avatarSrc: window.PHOTO_USER,
    meta: "S\xE1bado, 12 de setembro",
    actions: [{
      icon: "pencil",
      label: "Editar perfil"
    }, {
      icon: "bell",
      label: "Notificações",
      badge: "9+"
    }]
  })), /*#__PURE__*/React.createElement(ScreenBody, null, /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Resumo geral"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    icon: "contact-round",
    value: 3,
    label: "Visitas hoje",
    hint: "Agendadas para hoje",
    onClick: () => onTab("visitantes")
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "package",
    value: 2,
    label: "Encomendas",
    hint: "Aguardando retirada",
    tone: "success",
    onClick: () => onTab("encomendas")
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    size: "lg",
    title: "Meus condom\xEDnios",
    count: "2 condom\xEDnios"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--gap-row)"
    }
  }, window.CONDOS.map(c => /*#__PURE__*/React.createElement(ListRow, {
    key: c.id,
    onClick: () => onOpenCondo(c.id),
    leading: c.photo ? /*#__PURE__*/React.createElement(Avatar, {
      square: true,
      src: c.photo,
      name: c.name,
      size: "lg"
    }) : /*#__PURE__*/React.createElement(IconChip, {
      icon: "building-complex",
      size: "lg"
    }),
    title: c.name,
    subtitle: c.unit
  })))), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Meus eventos",
    actionLabel: "Ver todos",
    onAction: onSeeAllEvents
  }), /*#__PURE__*/React.createElement(CardStack, null, window.EVENTS.slice(0, 4).map((e, i, a) => /*#__PURE__*/React.createElement(EventRow, _extends({
    key: e.id
  }, e, {
    style: i === a.length - 1 ? {
      borderBottom: "none"
    } : undefined
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 16px 14px",
      borderTop: "1px solid var(--border-row)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onSeeAllEvents,
    style: {
      color: "var(--text-link)"
    }
  }, "11 eventos recentes"))))));
}
Object.assign(window, {
  HomeScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/HomeScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/PackagesScreen.kit.js
try { (() => {
/* Encomendas was not present in the supplied screenshots beyond its tab and counters.
   This screen composes existing patterns only — no new visual language was invented. */
function PackagesScreen() {
  const {
    AppBar,
    ListRow,
    IconChip,
    Badge,
    SectionHeader,
    Button,
    EmptyState
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody,
    CardStack
  } = window;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Encomendas",
    actions: [{
      icon: "qr-code",
      label: "Retirar com QR"
    }]
  }), /*#__PURE__*/React.createElement(ScreenBody, {
    style: {
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Aguardando retirada",
    count: "2 encomendas"
  }), /*#__PURE__*/React.createElement(CardStack, null, /*#__PURE__*/React.createElement(ListRow, {
    leading: /*#__PURE__*/React.createElement(IconChip, {
      icon: "package",
      tone: "success"
    }),
    title: "Pacote \xB7 Mercado Livre",
    subtitle: "Recebido 11/09 \xE0s 09:12 \xB7 Portaria",
    trailing: /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      uppercase: true
    }, "Pronto"),
    style: {
      border: "none",
      borderRadius: 0,
      boxShadow: "none",
      borderBottom: "1px solid var(--border-row)"
    }
  }), /*#__PURE__*/React.createElement(ListRow, {
    leading: /*#__PURE__*/React.createElement(IconChip, {
      icon: "package",
      tone: "success"
    }),
    title: "Envelope \xB7 Correios",
    subtitle: "Recebido 10/09 \xE0s 16:40 \xB7 Portaria",
    trailing: /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      uppercase: true
    }, "Pronto"),
    style: {
      border: "none",
      borderRadius: 0,
      boxShadow: "none"
    }
  })), /*#__PURE__*/React.createElement(Button, {
    fullWidth: true,
    iconLeft: "qr-code"
  }, "Gerar c\xF3digo de retirada"), /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Hist\xF3rico",
    count: "\xDAltimos 30 dias"
  }), /*#__PURE__*/React.createElement(EmptyState, {
    icon: "clock",
    title: "Nenhuma retirada recente",
    description: "Encomendas retiradas aparecem aqui por 30 dias."
  })));
}
Object.assign(window, {
  PackagesScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/PackagesScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/Shell.kit.js
try { (() => {
/** Scrollable screen body with the gutter and tab-bar clearance every Prestare screen needs. */
function ScreenBody({
  children,
  style
}) {
  const {
    TabBar
  } = window.PrestareDesignSystem_ea5733;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "0 var(--gutter-screen) 104px",
      display: "grid",
      gap: "var(--gap-section)",
      alignContent: "start",
      ...style
    }
  }, children);
}

/** White card that wraps a stack of hairline-divided rows. */
function CardStack({
  children,
  style
}) {
  const {
    TabBar
  } = window.PrestareDesignSystem_ea5733;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-row)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-card)",
      overflow: "hidden",
      ...style
    }
  }, children);
}
function FloatingNav({
  tab,
  onChange
}) {
  const {
    TabBar
  } = window.PrestareDesignSystem_ea5733;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 28,
      background: "linear-gradient(to top,var(--surface-app),rgba(247,248,250,0))"
    }
  }), /*#__PURE__*/React.createElement(TabBar, {
    value: tab,
    onChange: onChange,
    items: window.TABS
  }));
}
Object.assign(window, {
  ScreenBody,
  CardStack,
  FloatingNav
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/Shell.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/VisitorsScreen.kit.js
try { (() => {
function VisitorsScreen() {
  const {
    AppBar,
    SearchField,
    FilterChipRow,
    ListRow,
    Avatar,
    Badge,
    PinReveal,
    EmptyState,
    Button
  } = window.PrestareDesignSystem_ea5733;
  const {
    ScreenBody
  } = window;
  const [q, setQ] = React.useState("");
  const [tipo, setTipo] = React.useState("todos");
  const [pres, setPres] = React.useState("local");
  const [copied, setCopied] = React.useState(null);
  const list = window.PEOPLE.filter(p => (tipo === "todos" || p.type === tipo) && (pres === "cad" || p.onsite) && p.name.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Visitantes e prestadores",
    actions: [{
      icon: "link-2",
      label: "Convite por link"
    }, {
      icon: "bell",
      label: "Notificações"
    }]
  }), /*#__PURE__*/React.createElement(ScreenBody, {
    style: {
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SearchField, {
    value: q,
    onChange: setQ,
    onClear: () => setQ("")
  }), /*#__PURE__*/React.createElement(FilterChipRow, {
    value: tipo,
    onChange: setTipo,
    items: [{
      id: "todos",
      label: "Todos",
      count: 30
    }, {
      id: "vis",
      label: "Visitantes",
      count: 26
    }, {
      id: "pres",
      label: "Prestadores",
      count: 4
    }]
  }), /*#__PURE__*/React.createElement(FilterChipRow, {
    variant: "solid",
    value: pres,
    onChange: setPres,
    items: [{
      id: "local",
      label: "No local",
      icon: "house",
      count: 2
    }, {
      id: "cad",
      label: "Cadastrados",
      icon: "id-card",
      count: 9
    }]
  }), list.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "contact-round",
    title: "Nenhum resultado",
    description: "Ajuste os filtros ou cadastre um novo visitante.",
    actionLabel: "Cadastrar visitante"
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--gap-row)"
    }
  }, list.map(p => /*#__PURE__*/React.createElement(ListRow, {
    key: p.id,
    leading: /*#__PURE__*/React.createElement(Avatar, {
      src: p.photo,
      name: p.name,
      status: p.onsite ? "onsite" : undefined
    }),
    overline: p.condo,
    title: p.name,
    subtitle: null,
    meta: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-body-strong)",
        color: "var(--text-link)",
        fontSize: 14
      }
    }, p.unit), p.onsite && /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      uppercase: true
    }, "No local"), p.syncing && /*#__PURE__*/React.createElement(Badge, {
      tone: "warning",
      uppercase: true,
      icon: "refresh-cw"
    }, "Sinc."), p.pin && /*#__PURE__*/React.createElement(PinReveal, {
      pin: p.pin,
      copied: copied === p.id,
      onCopy: () => setCopied(copied === p.id ? null : p.id)
    }))
  }))), /*#__PURE__*/React.createElement(Button, {
    fullWidth: true,
    iconLeft: "user-round-plus"
  }, "Cadastrar visitante")));
}
Object.assign(window, {
  VisitorsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/VisitorsScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-app/data.kit.js
try { (() => {
const PHOTO_USER = "../../assets/reference/avatar-user.png";
const PHOTO_BUILDING = "../../assets/reference/thumb-edificio-demo.png";
const CONDOS = [{
  id: "demo",
  name: "Edifício Demo",
  unit: "Bloco A · Apto 101",
  photo: PHOTO_BUILDING,
  encomendas: 2,
  visitas: 3,
  modules: 14
}, {
  id: "api",
  name: "Teste Prestare API",
  unit: "Bloco A · Apto 1",
  photo: null,
  encomendas: 0,
  visitas: 0,
  modules: 9
}];
const EVENTS = [{
  id: 1,
  name: "Vinicius Vilela Rufini",
  direction: "in",
  timestamp: "11/09/2026 às 23:34",
  role: "Visitante"
}, {
  id: 2,
  name: "Teresinha Martins",
  direction: "in",
  timestamp: "11/09/2026 às 11:31",
  role: "Visitante"
}, {
  id: 3,
  name: "Rodrigo Rufini",
  direction: "in",
  timestamp: "11/09/2026 às 11:06",
  role: "Visitante"
}, {
  id: 4,
  name: "Teresinha Martins",
  direction: "out",
  timestamp: "11/09/2026 às 10:45",
  role: "Visitante"
}, {
  id: 5,
  name: "Célia Alves",
  direction: "out",
  timestamp: "10/09/2026 às 19:02",
  role: "Prestador"
}, {
  id: 6,
  name: "Marcos Lima",
  direction: "in",
  timestamp: "10/09/2026 às 14:20",
  role: "Prestador"
}];
const MODULES = [{
  id: "mudanca",
  icon: "truck",
  label: "Agendar mudança"
}, {
  id: "areas",
  icon: "users-round",
  label: "Áreas sociais"
}, {
  id: "assembleias",
  icon: "users",
  label: "Assembleias e votações"
}, {
  id: "cadastrar",
  icon: "user-round-plus",
  label: "Cadastrar visitante"
}, {
  id: "comunicados",
  icon: "megaphone",
  label: "Comunicados",
  badge: 3
}, {
  id: "enquetes",
  icon: "chart-column",
  label: "Enquetes"
}, {
  id: "documentos",
  icon: "file-text",
  label: "Documentos"
}, {
  id: "academia",
  icon: "dumbbell",
  label: "Academia"
}, {
  id: "encomendas",
  icon: "package",
  label: "Encomendas",
  badge: 2
}, {
  id: "veiculos",
  icon: "car",
  label: "Veículos"
}, {
  id: "portaria",
  icon: "shield-check",
  label: "Falar com a portaria"
}, {
  id: "chaves",
  icon: "key-round",
  label: "Chaves e PINs"
}, {
  id: "reservas",
  icon: "calendar-days",
  label: "Minhas reservas"
}, {
  id: "ajustes",
  icon: "settings",
  label: "Ajustes do condomínio"
}];
const PEOPLE = [{
  id: "vin",
  name: "Vinicius Vilela Rufini",
  condo: "Edifício Demo",
  unit: "A · 101",
  type: "vis",
  onsite: true,
  pin: "949-210",
  syncing: true,
  photo: PHOTO_USER
}, {
  id: "rod",
  name: "Rodrigo Rufini",
  condo: "Edifício Demo",
  unit: "A · 101",
  type: "vis",
  onsite: true,
  pin: null
}, {
  id: "ter",
  name: "Teresinha Martins",
  condo: "Edifício Demo",
  unit: "A · 101",
  type: "vis",
  onsite: false,
  pin: "310-884"
}, {
  id: "cel",
  name: "Célia Alves",
  condo: "Edifício Demo",
  unit: "A · 101",
  type: "pres",
  onsite: false,
  pin: null
}, {
  id: "mar",
  name: "Marcos Lima — Eletricista",
  condo: "Teste Prestare API",
  unit: "A · 1",
  type: "pres",
  onsite: false,
  pin: "558-102"
}];
const ACCOUNTS = [{
  id: "cond",
  icon: "building-complex",
  label: "Condomínio",
  tone: "brand",
  pending: 1
}, {
  id: "aluguel",
  icon: "house",
  label: "Aluguel",
  tone: "violet",
  pending: 0
}, {
  id: "agua",
  icon: "droplet",
  label: "Água",
  tone: "cyan",
  pending: 0
}, {
  id: "luz",
  icon: "zap",
  label: "Luz",
  tone: "warning",
  pending: 1
}, {
  id: "internet",
  icon: "wifi",
  label: "Internet",
  tone: "brand",
  pending: 0
}, {
  id: "outros",
  icon: "ellipsis",
  label: "Outros",
  tone: "neutral",
  pending: 0
}];
const MONTHS = [{
  id: "jul",
  label: "Jul",
  year: 26
}, {
  id: "ago",
  label: "Ago",
  year: 26
}, {
  id: "set",
  label: "Set",
  year: 26
}, {
  id: "out",
  label: "Out",
  year: 26
}, {
  id: "nov",
  label: "Nov",
  year: 26
}];
const TABS = [{
  id: "inicio",
  label: "Início",
  icon: "house"
}, {
  id: "encomendas",
  label: "Encomendas",
  icon: "package"
}, {
  id: "condominios",
  label: "Condomínios",
  icon: "building-complex"
}, {
  id: "visitantes",
  label: "Visitantes",
  icon: "contact-round"
}, {
  id: "financeiro",
  label: "Financeiro",
  icon: "wallet"
}];
Object.assign(window, {
  CONDOS,
  EVENTS,
  MODULES,
  PEOPLE,
  ACCOUNTS,
  MONTHS,
  TABS,
  PHOTO_USER,
  PHOTO_BUILDING
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-app/data.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RApp.kit.js
try { (() => {
function RPrestareApp({
  initial = "inicio"
}) {
  const {
    PhoneFrame
  } = window.PrestareDesignSystem_ea5733;
  const {
    RNav,
    RHomeScreen,
    RCondoScreen,
    RVisitorsScreen,
    RFinanceScreen
  } = window;
  const [tab, setTab] = React.useState(initial);
  const [route, setRoute] = React.useState({
    name: initial
  });
  const go = t => {
    setTab(t);
    setRoute({
      name: t
    });
  };
  let screen;
  if (route.name === "condominios") screen = /*#__PURE__*/React.createElement(RCondoScreen, {
    onBack: () => go("inicio")
  });else if (route.name === "visitantes") screen = /*#__PURE__*/React.createElement(RVisitorsScreen, null);else if (route.name === "financeiro") screen = /*#__PURE__*/React.createElement(RFinanceScreen, null);else if (route.name === "encomendas") screen = /*#__PURE__*/React.createElement(RFinanceScreen, null);else screen = /*#__PURE__*/React.createElement(RHomeScreen, {
    onTab: go,
    onOpenCondo: () => go("condominios"),
    onSeeAllEvents: () => {}
  });
  return /*#__PURE__*/React.createElement(PhoneFrame, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, screen, /*#__PURE__*/React.createElement(RNav, {
    tab: tab,
    onChange: go
  })));
}
Object.assign(window, {
  RPrestareApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RApp.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RCondoScreen.kit.js
try { (() => {
function RCondoScreen({
  onBack
}) {
  const {
    AppBar,
    Icon,
    IconChip,
    SearchField,
    Badge
  } = window.PrestareDesignSystem_ea5733;
  const {
    RBody,
    RCard,
    RGroupLabel
  } = window;
  const [q, setQ] = React.useState("");
  const c = window.R_CONDOS[0];
  const groups = window.R_MODULE_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()))
  })).filter(g => g.items.length);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: c.name,
    eyebrow: "Bloco A \xB7 Apto 101",
    onBack: onBack,
    actions: [{
      icon: "shield-check",
      label: "Portaria"
    }, {
      icon: "settings",
      label: "Ajustes"
    }]
  }), /*#__PURE__*/React.createElement(RBody, {
    style: {
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14,
      padding: 16,
      background: "var(--gradient-hero)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--glow-brand)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: c.photo,
    alt: "",
    width: "52",
    height: "52",
    style: {
      borderRadius: "var(--radius-thumb)",
      objectFit: "cover",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-on-brand)"
    }
  }, c.name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, "S\xEDndico: Rodrigo Rufini")), /*#__PURE__*/React.createElement("button", {
    className: "ps-pressable ps-iconbtn-on-brand",
    "aria-label": "Documentos",
    style: {
      width: 44,
      height: 44,
      border: 0,
      borderRadius: "var(--radius-pill)",
      background: "rgba(255,255,255,.18)",
      color: "#fff",
      display: "grid",
      placeItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 20
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      borderTop: "1px solid rgba(255,255,255,.22)",
      paddingTop: 13
    }
  }, [{
    icon: "house",
    value: c.onsite,
    label: "No local",
    live: true
  }, {
    icon: "package",
    value: c.encomendas,
    label: "Encomendas"
  }, {
    icon: "contact-round",
    value: c.visitas,
    label: "Visitas hoje"
  }].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    style: {
      flex: "1 1 0",
      display: "grid",
      gap: 2,
      justifyItems: "center",
      borderLeft: i ? "1px solid rgba(255,255,255,.22)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, s.live && /*#__PURE__*/React.createElement("span", {
    className: "ps-live-dot",
    style: {
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: "var(--green-500)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-on-brand)"
    }
  }, s.value)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, s.label))))), /*#__PURE__*/React.createElement(SearchField, {
    value: q,
    onChange: setQ,
    onClear: () => setQ(""),
    placeholder: "Buscar em 12 m\xF3dulos"
  }), groups.map(g => /*#__PURE__*/React.createElement("section", {
    key: g.id,
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(RGroupLabel, null, g.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 10
    }
  }, g.items.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    className: "ps-pressable ps-tile",
    style: {
      position: "relative",
      display: "grid",
      gap: 8,
      justifyItems: "center",
      padding: "14px 6px",
      background: "var(--surface-card)",
      border: "1px solid var(--border-row)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-row)",
      minHeight: 92
    }
  }, /*#__PURE__*/React.createElement(IconChip, {
    icon: m.icon
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-strong)",
      textAlign: "center",
      textWrap: "balance",
      lineHeight: "14px"
    }
  }, m.label), m.badge && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 8,
      right: 8,
      minWidth: 19,
      height: 19,
      padding: "0 5px",
      display: "grid",
      placeItems: "center",
      background: "var(--red-500)",
      color: "#fff",
      font: "var(--weight-bold) 11px/1 var(--font-ui)",
      borderRadius: "var(--radius-pill)"
    }
  }, m.badge))))))));
}
Object.assign(window, {
  RCondoScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RCondoScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RFinanceScreen.kit.js
try { (() => {
function RFinanceScreen() {
  const {
    AppBar,
    SegmentedControl,
    MonthStrip,
    SectionHeader,
    Icon,
    IconChip,
    Badge,
    Button
  } = window.PrestareDesignSystem_ea5733;
  const {
    RBody,
    RCard,
    RGroupLabel
  } = window;
  const [scope, setScope] = React.useState("meu");
  const [mes, setMes] = React.useState("set");
  const pending = window.R_ACCOUNTS.filter(a => a.pending);
  const paidPct = 62;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Financeiro",
    actions: [{
      icon: "download",
      label: "Baixar extrato"
    }]
  }), /*#__PURE__*/React.createElement(RBody, {
    style: {
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    value: scope,
    onChange: setScope,
    items: [{
      id: "meu",
      label: "Meu financeiro"
    }, {
      id: "cond",
      label: "Condomínio"
    }]
  }), /*#__PURE__*/React.createElement(MonthStrip, {
    value: mes,
    onChange: setMes,
    months: window.R_MONTHS
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14,
      padding: 18,
      background: "var(--gradient-hero)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--glow-brand)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-on-brand-muted)",
      fontWeight: "var(--weight-medium)"
    }
  }, "Total pendente"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      height: 24,
      padding: "0 10px",
      background: "rgba(255,255,255,.18)",
      borderRadius: "var(--radius-pill)",
      font: "var(--type-caption)",
      color: "var(--text-on-brand)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 13,
    strokeWidth: 2.2
  }), "Vence 18/09")), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-amount)",
      color: "var(--text-on-brand)",
      fontVariantNumeric: "tabular-nums"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: "var(--weight-bold)",
      marginRight: 8,
      verticalAlign: "2px"
    }
  }, "BRL"), "1.258,19"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      borderRadius: 3,
      background: "rgba(255,255,255,.22)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: paidPct + "%",
      height: "100%",
      background: "#fff",
      borderRadius: 3
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, paidPct, "% do m\xEAs j\xE1 quitado \xB7 4 de 6 contas pagas")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    iconLeft: "qr-code",
    style: {
      background: "#fff",
      color: "var(--prestare-blue-600)",
      boxShadow: "none"
    }
  }, "Pagar com Pix")), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    icon: "circle-alert",
    title: "A pagar",
    count: `${pending.length} contas`
  }), /*#__PURE__*/React.createElement(RCard, {
    style: {
      borderColor: "var(--red-100)"
    }
  }, pending.map((a, i, arr) => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "ps-pressable ps-row",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "13px 14px",
      borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--border-row)"
    }
  }, /*#__PURE__*/React.createElement(IconChip, {
    icon: a.icon,
    tone: a.tone,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-strong)",
      color: "var(--text-strong)"
    }
  }, a.label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-danger)"
    }
  }, "Vence ", a.due)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)",
      fontVariantNumeric: "tabular-nums"
    }
  }, a.amount), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 18,
    color: "var(--icon-muted)"
  }))))), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(RGroupLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        color: "var(--text-link)"
      }
    }, "Nova conta")
  }, "Em dia"), /*#__PURE__*/React.createElement(RCard, null, window.R_ACCOUNTS.filter(a => !a.pending).map((a, i, arr) => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "ps-pressable ps-row",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 14px",
      borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--border-row)"
    }
  }, /*#__PURE__*/React.createElement(IconChip, {
    icon: a.icon,
    tone: a.tone,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body)",
      color: "var(--text-body)",
      flex: 1
    }
  }, a.label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, a.amount), /*#__PURE__*/React.createElement(Icon, {
    name: "circle-check",
    size: 17,
    color: "var(--green-500)"
  })))))));
}
Object.assign(window, {
  RFinanceScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RFinanceScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RHomeScreen.kit.js
try { (() => {
function RHomeScreen({
  onTab,
  onOpenCondo,
  onSeeAllEvents
}) {
  const {
    Avatar,
    IconButton,
    Icon,
    Badge,
    SectionHeader,
    IconChip,
    PinReveal,
    Button
  } = window.PrestareDesignSystem_ea5733;
  const {
    RBody,
    RCard,
    RGroupLabel
  } = window;
  const [copied, setCopied] = React.useState(null);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "6px 16px 16px"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: window.R_PHOTO_USER,
    name: "Vinicius",
    size: "md"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-faint)"
    }
  }, "S\xE1bado, 12 de setembro"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, "Ol\xE1, Vinicius")), /*#__PURE__*/React.createElement(IconButton, {
    icon: "bell",
    label: "Notifica\xE7\xF5es",
    badge: "9+"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "settings",
    label: "Ajustes"
  })), /*#__PURE__*/React.createElement(RBody, null, /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14,
      padding: 16,
      background: "var(--gradient-hero)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--glow-brand)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ps-live-dot",
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "var(--green-500)",
      boxShadow: "0 0 0 3px rgba(6,193,142,.28)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-overline)",
      letterSpacing: "var(--text-overline-ls)",
      textTransform: "uppercase",
      color: "var(--text-on-brand)"
    }
  }, "No local agora"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, "Edif\xEDcio Demo \xB7 A 101")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10
    }
  }, window.R_ONSITE.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: p.photo,
    name: p.name,
    size: "sm",
    ring: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-strong)",
      color: "var(--text-on-brand)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.short), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-brand-muted)"
    }
  }, p.type, " \xB7 entrou ", p.since)), p.pin && /*#__PURE__*/React.createElement("button", {
    onClick: () => setCopied(copied === p.id ? null : p.id),
    className: "ps-pressable",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 30,
      padding: "0 10px",
      background: "rgba(255,255,255,.18)",
      border: 0,
      borderRadius: "var(--radius-sm)",
      color: "var(--text-on-brand)",
      font: "var(--weight-bold) 14px/1 var(--font-ui)",
      fontVariantNumeric: "tabular-nums",
      letterSpacing: ".04em"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: copied === p.id ? "check" : "key-round",
    size: 14,
    strokeWidth: 2.4
  }), p.pin))))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    fullWidth: true,
    iconLeft: "user-round-plus",
    onClick: () => onTab("visitantes")
  }, "Liberar uma entrada")), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(RGroupLabel, null, "Hoje"), /*#__PURE__*/React.createElement(RCard, {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr"
    }
  }, [{
    icon: "contact-round",
    value: 3,
    label: "Visitas",
    tone: "brand",
    tab: "visitantes"
  }, {
    icon: "package",
    value: 2,
    label: "Encomendas",
    tone: "success",
    tab: "encomendas"
  }, {
    icon: "circle-alert",
    value: 2,
    label: "Pendências",
    tone: "danger",
    tab: "financeiro"
  }].map((s, i) => /*#__PURE__*/React.createElement("button", {
    key: s.label,
    onClick: () => onTab(s.tab),
    className: "ps-pressable ps-row",
    style: {
      border: 0,
      background: "transparent",
      padding: "14px 6px",
      display: "grid",
      gap: 6,
      justifyItems: "center",
      borderLeft: i ? "1px solid var(--border-row)" : "none"
    }
  }, /*#__PURE__*/React.createElement(IconChip, {
    icon: s.icon,
    tone: s.tone,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h2)",
      color: "var(--text-strong)"
    }
  }, s.value), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, s.label))))), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Meus condom\xEDnios",
    count: "2"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10
    }
  }, window.R_CONDOS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.id,
    onClick: () => onOpenCondo(c.id),
    className: "ps-pressable ps-tile",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: 12,
      textAlign: "left",
      background: "var(--surface-card)",
      border: "1px solid var(--border-row)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-row)"
    }
  }, c.photo ? /*#__PURE__*/React.createElement(Avatar, {
    square: true,
    src: c.photo,
    name: c.name,
    size: "lg"
  }) : /*#__PURE__*/React.createElement(IconChip, {
    icon: "building-complex",
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 4,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, c.name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, c.unit), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 2
    }
  }, c.onsite > 0 && /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, c.onsite, " no local"), c.encomendas > 0 && /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    icon: "package"
  }, c.encomendas), c.onsite === 0 && c.encomendas === 0 && /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Sem novidades"))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 20,
    color: "var(--icon-muted)"
  }))))), /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    title: "Meus eventos",
    actionLabel: "Ver todos",
    onAction: onSeeAllEvents
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14
    }
  }, window.R_EVENT_DAYS.slice(0, 1).map(d => /*#__PURE__*/React.createElement("div", {
    key: d.day,
    style: {
      display: "grid",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(RGroupLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        color: "var(--text-faint)"
      }
    }, d.label)
  }, d.day), /*#__PURE__*/React.createElement(RCard, null, d.events.map((e, i, a) => {
    const isIn = e.direction === "in";
    return /*#__PURE__*/React.createElement("div", {
      key: e.id,
      className: "ps-pressable ps-row",
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 14px",
        borderBottom: i === a.length - 1 ? "none" : "1px solid var(--border-row)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--weight-bold) 13px/1 var(--font-ui)",
        color: "var(--text-muted)",
        fontVariantNumeric: "tabular-nums",
        width: 38,
        flex: "none"
      }
    }, e.time), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 30,
        height: 30,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-sm)",
        background: isIn ? "var(--prestare-blue-100)" : "var(--violet-100)",
        color: isIn ? "var(--prestare-blue-500)" : "var(--violet-500)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: isIn ? "arrow-down-left" : "arrow-up-right",
      size: 16
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-body-strong)",
        color: "var(--text-strong)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, e.name), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        color: isIn ? "var(--status-in)" : "var(--status-out)"
      }
    }, isIn ? "Entrou" : "Saiu", " \xB7 ", e.role)), /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-right",
      size: 17,
      color: "var(--icon-muted)"
    }));
  }))))))));
}
Object.assign(window, {
  RHomeScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RHomeScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RShell.kit.js
try { (() => {
/** Shared layout glue for the redesigned screens. */
function RBody({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "0 16px 104px",
      display: "grid",
      gap: 22,
      alignContent: "start",
      ...style
    }
  }, children);
}
function RCard({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-row)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-card)",
      overflow: "hidden",
      ...style
    }
  }, children);
}
function RNav({
  tab,
  onChange
}) {
  const {
    TabBar
  } = window.PrestareDesignSystem_ea5733;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 28,
      background: "linear-gradient(to top,var(--surface-app),rgba(247,248,250,0))"
    }
  }), /*#__PURE__*/React.createElement(TabBar, {
    value: tab,
    onChange: onChange,
    items: window.R_TABS
  }));
}

/** Small label above a group of content. Lighter than SectionHeader — used inside cards. */
function RGroupLabel({
  children,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      padding: "0 2px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-overline)",
      letterSpacing: "var(--text-overline-ls)",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, children), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), right);
}
Object.assign(window, {
  RBody,
  RCard,
  RNav,
  RGroupLabel
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RShell.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/RVisitorsScreen.kit.js
try { (() => {
function RVisitorsScreen() {
  const {
    AppBar,
    SearchField,
    SegmentedControl,
    Avatar,
    Badge,
    Icon,
    Button,
    IconChip,
    EmptyState
  } = window.PrestareDesignSystem_ea5733;
  const {
    RBody,
    RCard,
    RGroupLabel
  } = window;
  const [scope, setScope] = React.useState("local");
  const [q, setQ] = React.useState("");
  const [copied, setCopied] = React.useState(null);
  const registered = [{
    id: "ter",
    name: "Teresinha Martins",
    unit: "A · 101",
    type: "Visitante",
    pin: "310-884",
    last: "Saiu ontem às 10:45"
  }, {
    id: "cel",
    name: "Célia Alves",
    unit: "A · 101",
    type: "Prestador",
    pin: null,
    last: "Saiu 11/09 às 19:02"
  }, {
    id: "mar",
    name: "Marcos Lima",
    unit: "A · 101",
    type: "Prestador",
    pin: "558-102",
    last: "Entrou 11/09 às 14:20"
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppBar, {
    title: "Visitantes",
    actions: [{
      icon: "link-2",
      label: "Convite por link"
    }]
  }), /*#__PURE__*/React.createElement(RBody, {
    style: {
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    value: scope,
    onChange: setScope,
    items: [{
      id: "local",
      label: "No local (2)"
    }, {
      id: "cad",
      label: "Cadastrados (9)"
    }]
  }), scope === "local" ?
  /*#__PURE__*/
  /* Presence cards, not rows: the PIN and the time on site are the two things
     a resident actually needs, so they get real estate instead of a 22px badge. */
  React.createElement("div", {
    style: {
      display: "grid",
      gap: 12
    }
  }, window.R_ONSITE.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "grid",
      gap: 14,
      padding: 14,
      background: "var(--surface-card)",
      border: "1px solid var(--green-100)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--shadow-card)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: p.photo,
    name: p.name,
    size: "lg",
    status: "onsite"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 3,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, p.type, " \xB7 ", p.unit)), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    uppercase: true,
    dot: true
  }, "No local")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingTop: 12,
      borderTop: "1px solid var(--border-row)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-caption)",
      color: "var(--text-muted)",
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 15,
    color: "var(--icon-muted)"
  }), "Entrou ", p.since), p.pin ? /*#__PURE__*/React.createElement("button", {
    onClick: () => setCopied(copied === p.id ? null : p.id),
    className: "ps-pressable",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      height: 34,
      padding: "0 12px",
      background: "var(--prestare-blue-50)",
      border: "1px solid var(--prestare-blue-100)",
      borderRadius: "var(--radius-sm)",
      color: "var(--prestare-blue-600)",
      font: "var(--weight-bold) 15px/1 var(--font-ui)",
      fontVariantNumeric: "tabular-nums",
      letterSpacing: ".04em"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: copied === p.id ? "check" : "key-round",
    size: 15,
    strokeWidth: 2.4
  }), p.pin) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-faint)"
    }
  }, "Sem PIN"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    iconLeft: "x"
  }, "Encerrar"))))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SearchField, {
    value: q,
    onChange: setQ,
    onClear: () => setQ("")
  }), /*#__PURE__*/React.createElement(RGroupLabel, null, "Cadastrados"), /*#__PURE__*/React.createElement(RCard, null, registered.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map((p, i, a) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "ps-pressable ps-row",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 14px",
      borderBottom: i === a.length - 1 ? "none" : "1px solid var(--border-row)"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: p.name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-strong)",
      color: "var(--text-strong)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, p.type, " \xB7 ", p.last)), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 18,
    color: "var(--icon-muted)"
  })))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 88
    }
  }, /*#__PURE__*/React.createElement(Button, {
    fullWidth: true,
    iconLeft: "user-round-plus"
  }, "Liberar entrada")));
}
Object.assign(window, {
  RVisitorsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/RVisitorsScreen.kit.js", error: String((e && e.message) || e) }); }

// ui_kits/prestare-redesign/data.kit.js
try { (() => {
const R_PHOTO_USER = "../../assets/reference/avatar-user.png";
const R_PHOTO_BUILDING = "../../assets/reference/thumb-edificio-demo.png";
const R_ONSITE = [{
  id: "vin",
  name: "Vinicius Vilela Rufini",
  short: "Vinicius",
  unit: "A · 101",
  since: "há 2h14",
  pin: "949-210",
  photo: R_PHOTO_USER,
  type: "Visitante"
}, {
  id: "rod",
  name: "Rodrigo Rufini",
  short: "Rodrigo",
  unit: "A · 101",
  since: "há 38min",
  pin: null,
  photo: null,
  type: "Visitante"
}];
const R_EVENT_DAYS = [{
  day: "Hoje",
  label: "12 de setembro",
  events: [{
    id: 1,
    name: "Vinicius Vilela Rufini",
    direction: "in",
    time: "23:34",
    role: "Visitante"
  }, {
    id: 2,
    name: "Teresinha Martins",
    direction: "in",
    time: "11:31",
    role: "Visitante"
  }, {
    id: 3,
    name: "Rodrigo Rufini",
    direction: "in",
    time: "11:06",
    role: "Visitante"
  }, {
    id: 4,
    name: "Teresinha Martins",
    direction: "out",
    time: "10:45",
    role: "Visitante"
  }]
}, {
  day: "Ontem",
  label: "11 de setembro",
  events: [{
    id: 5,
    name: "Célia Alves",
    direction: "out",
    time: "19:02",
    role: "Prestador"
  }, {
    id: 6,
    name: "Marcos Lima",
    direction: "in",
    time: "14:20",
    role: "Prestador"
  }]
}];
const R_MODULE_GROUPS = [{
  id: "acesso",
  label: "Acesso",
  items: [{
    id: "cadastrar",
    icon: "user-round-plus",
    label: "Cadastrar visitante"
  }, {
    id: "chaves",
    icon: "key-round",
    label: "Chaves e PINs"
  }, {
    id: "portaria",
    icon: "shield-check",
    label: "Portaria"
  }, {
    id: "veiculos",
    icon: "car",
    label: "Veículos"
  }]
}, {
  id: "reservas",
  label: "Reservas",
  items: [{
    id: "areas",
    icon: "users-round",
    label: "Áreas sociais"
  }, {
    id: "academia",
    icon: "dumbbell",
    label: "Academia"
  }, {
    id: "mudanca",
    icon: "truck",
    label: "Mudança"
  }, {
    id: "minhas",
    icon: "calendar-days",
    label: "Minhas reservas",
    badge: 1
  }]
}, {
  id: "comunidade",
  label: "Comunidade",
  items: [{
    id: "comunicados",
    icon: "megaphone",
    label: "Comunicados",
    badge: 3
  }, {
    id: "assembleias",
    icon: "users",
    label: "Assembleias"
  }, {
    id: "enquetes",
    icon: "chart-column",
    label: "Enquetes"
  }, {
    id: "documentos",
    icon: "file-text",
    label: "Documentos"
  }]
}];
const R_ACCOUNTS = [{
  id: "cond",
  icon: "building-complex",
  label: "Condomínio",
  tone: "brand",
  amount: "842,50",
  due: "20/09",
  pending: true
}, {
  id: "luz",
  icon: "zap",
  label: "Luz",
  tone: "warning",
  amount: "415,69",
  due: "18/09",
  pending: true
}, {
  id: "agua",
  icon: "droplet",
  label: "Água",
  tone: "cyan",
  amount: "128,40",
  due: null,
  pending: false
}, {
  id: "aluguel",
  icon: "house",
  label: "Aluguel",
  tone: "violet",
  amount: "2.100,00",
  due: null,
  pending: false
}, {
  id: "internet",
  icon: "wifi",
  label: "Internet",
  tone: "brand",
  amount: "119,90",
  due: null,
  pending: false
}, {
  id: "outros",
  icon: "ellipsis",
  label: "Outros",
  tone: "neutral",
  amount: "—",
  due: null,
  pending: false
}];
const R_MONTHS = [{
  id: "jul",
  label: "Jul",
  year: 26
}, {
  id: "ago",
  label: "Ago",
  year: 26
}, {
  id: "set",
  label: "Set",
  year: 26
}, {
  id: "out",
  label: "Out",
  year: 26
}, {
  id: "nov",
  label: "Nov",
  year: 26
}];
const R_CONDOS = [{
  id: "demo",
  name: "Edifício Demo",
  unit: "Bloco A · Apto 101",
  photo: R_PHOTO_BUILDING,
  encomendas: 2,
  visitas: 3,
  onsite: 2
}, {
  id: "api",
  name: "Teste Prestare API",
  unit: "Bloco A · Apto 1",
  photo: null,
  encomendas: 0,
  visitas: 0,
  onsite: 0
}];
const R_TABS = [{
  id: "inicio",
  label: "Início",
  icon: "house"
}, {
  id: "encomendas",
  label: "Encomendas",
  icon: "package"
}, {
  id: "condominios",
  label: "Condomínios",
  icon: "building-complex"
}, {
  id: "visitantes",
  label: "Visitantes",
  icon: "contact-round"
}, {
  id: "financeiro",
  label: "Financeiro",
  icon: "wallet"
}];
Object.assign(window, {
  R_ONSITE,
  R_EVENT_DAYS,
  R_MODULE_GROUPS,
  R_ACCOUNTS,
  R_MONTHS,
  R_CONDOS,
  R_TABS,
  R_PHOTO_USER,
  R_PHOTO_BUILDING
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prestare-redesign/data.kit.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.PRESTARE_ICONS = __ds_scope.PRESTARE_ICONS;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.IconChip = __ds_scope.IconChip;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.AccountTile = __ds_scope.AccountTile;

__ds_ns.AmountBanner = __ds_scope.AmountBanner;

__ds_ns.EventRow = __ds_scope.EventRow;

__ds_ns.ListRow = __ds_scope.ListRow;

__ds_ns.PinReveal = __ds_scope.PinReveal;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.FilterChipRow = __ds_scope.FilterChipRow;

__ds_ns.MonthStrip = __ds_scope.MonthStrip;

__ds_ns.SearchField = __ds_scope.SearchField;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.AppBar = __ds_scope.AppBar;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.HeroCard = __ds_scope.HeroCard;

__ds_ns.PhoneFrame = __ds_scope.PhoneFrame;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.TabBar = __ds_scope.TabBar;

})();
