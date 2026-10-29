import React from "react";

const glyphs = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
  animals: <><circle cx="7.5" cy="7" r="1.5"/><circle cx="16.5" cy="7" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="19.5" cy="12" r="1.5"/><path d="M8 17.5c0-2.6 1.8-4.5 4-4.5s4 1.9 4 4.5c0 1.7-1.2 2.5-2.3 2.1-.9-.3-2.5-.3-3.4 0C9.2 20 8 19.2 8 17.5Z"/></>,
  feeding: <><path d="M4 3v7M7 3v7M10 3v7M7 10v11"/><path d="M16 3c-1.7 2-2.5 4.5-2.5 7v2H18V3M16 12v9"/></>,
  care: <path d="M3 12h4l3-8 4 16 3-8h4"/>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15l2 2 5-4"/></>,
  reproduction: <><path d="M12 3c3 4 5 6.2 5 10a5 5 0 0 1-10 0c0-3.8 2-6 5-10Z"/><path d="M10 15c.4 1 1.1 1.5 2 1.5"/></>,
  inventory: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v10l9 5 9-5V8M12 13v10"/></>,
  documents: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
  genetics: <><path d="M7 3c10 4 10 14 0 18M17 3C7 7 7 17 17 21M8 6h8M6.5 10h11M6.5 14h11M8 18h8"/></>,
  finance: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M7 5V3h10v2M15 14h3"/></>,
  notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  data: <><path d="m17 3 4 4-4 4M3 7h18M7 13l-4 4 4 4M21 17H3"/></>,
  billing: <><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/></>,
  guide: <><path d="M12 7v14"/><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 0 3 23Z"/><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5A2.5 2.5 0 0 1 21 23Z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1.1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1.1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1.1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1.1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 .1 1.9Z"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16Z"/></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M9 12h6"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.8 3h15.4a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  close: <path d="m18 6-12 12M6 6l12 12"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  back: <><path d="M19 12H5M12 19l-7-7 7-7"/></>,
  next: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
  weight: <><path d="M5 7h14l2 14H3L5 7Z"/><path d="M9 7a3 3 0 0 1 6 0M12 12l2 3"/></>,
  task: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M14 10h2M8 15h8"/></>,
  book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22Z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20"/></>,
  snake: <><path d="M5 6c0-2 2-3 4-2 2 1 1 3 3 4s5 0 6 2-1 4-3 4H9c-2 0-4 1-4 3s2 3 4 3 4-1 4-3"/><path d="M8 6h.01M16 11h.01"/></>,
  circle: <circle cx="12" cy="12" r="9"/>
};

export function Icon({ name = "circle", size = 18, strokeWidth = 1.8, className = "", title = "" }) {
  return <svg className={("ui-icon " + className).trim()} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined} aria-label={title}>{title && <title>{title}</title>}{glyphs[name] || glyphs.circle}</svg>;
}
