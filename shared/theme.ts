/**
 * TBRN-Games Design Tokens — single source of truth for all visual design.
 * Used by screen and controller clients. Import as ES module.
 */

export const theme = {
  // --- Color Palette (8 colors) ---
  colors: {
    // Primary brand
    primary: "#2E7DFF",      // Blue
    primaryHover: "#1A66E0",
    primaryLight: "#E8F0FF",

    // Secondary
    secondary: "#FF6B35",    // Orange
    secondaryHover: "#E05528",
    secondaryLight: "#FFF0EB",

    // Success/Good
    success: "#10B981",      // Emerald
    successLight: "#ECFDF5",

    // Warning
    warning: "#F59E0B",      // Amber
    warningLight: "#FFFBEB",

    // Error/Bad
    error: "#EF4444",        // Red
    errorLight: "#FEF2F2",

    // Neutrals
    background: "#0F172A",   // Slate 950
    surface: "#1E293B",      // Slate 800
    surfaceHover: "#334155", // Slate 700
    border: "#334155",       // Slate 700

    // Text
    textPrimary: "#F8FAFC",  // Slate 50
    textSecondary: "#94A3B8", // Slate 400
    textMuted: "#64748B",    // Slate 500
    textInverse: "#0F172A",  // On primary/secondary

    // Player colors (8 seats, one per seat identity). These match the TV kit
    // palette so a seat keeps the same colour from the lobby into a game.
    player: [
      "#FF2E97",  // Magenta (seat 1)
      "#00E5FF",  // Cyan (seat 2)
      "#FFE45E",  // Yellow (seat 3)
      "#3DFFA2",  // Green (seat 4)
      "#FF8A3D",  // Orange (seat 5)
      "#B084FF",  // Violet (seat 6)
      "#6EA8FE",  // Sky (seat 7)
      "#F5F3FF",  // Off-white (seat 8)
    ],
  },

  // --- Typography ---
  font: {
    family: {
      sans: '"Inter", "IBM Plex Sans", system-ui, -apple-system, sans-serif',
      mono: '"JetBrains Mono", "Fira Code", monospace',
      display: '"Inter", system-ui, sans-serif',
    },
    size: {
      xs: "0.75rem",    // 12px
      sm: "0.875rem",   // 14px
      base: "1rem",     // 16px
      lg: "1.125rem",   // 18px
      xl: "1.25rem",    // 20px
      "2xl": "1.5rem",  // 24px
      "3xl": "1.875rem", // 30px
      "4xl": "2.25rem",  // 36px
      "5xl": "3rem",     // 48px
      "6xl": "4rem",     // 64px
    },
    weight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.1,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  // --- Spacing (4px base) ---
  spacing: {
    0: "0",
    1: "0.25rem",   // 4px
    2: "0.5rem",    // 8px
    3: "0.75rem",   // 12px
    4: "1rem",      // 16px
    5: "1.25rem",   // 20px
    6: "1.5rem",    // 24px
    8: "2rem",      // 32px
    10: "2.5rem",   // 40px
    12: "3rem",     // 48px
    16: "4rem",     // 64px
    20: "5rem",     // 80px
    24: "6rem",     // 96px
  },

  // --- Border Radius ---
  radius: {
    none: "0",
    sm: "0.25rem",   // 4px
    md: "0.375rem",  // 6px
    lg: "0.5rem",    // 8px
    xl: "0.75rem",   // 12px
    "2xl": "1rem",   // 16px
    full: "9999px",
  },

  // --- Shadows ---
  shadow: {
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    glow: "0 0 20px rgb(46 125 255 / 0.3)",
    glowOrange: "0 0 20px rgb(255 107 53 / 0.3)",
  },

  // --- Motion ---
  motion: {
    duration: {
      instant: "0ms",
      fast: "100ms",
      normal: "200ms",
      slow: "300ms",
      slower: "500ms",
    },
    easing: {
      linear: "linear",
      easeIn: "cubic-bezier(0.4, 0, 1, 1)",
      easeOut: "cubic-bezier(0, 0, 0.2, 1)",
      easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
      spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    },
  },

  // --- Breakpoints (for responsive) ---
  breakpoint: {
    mobile: "480px",
    tablet: "768px",
    desktop: "1024px",
    wide: "1280px",
  },

  // --- Z-Index ---
  zIndex: {
    base: 0,
    dropdown: 100,
    modal: 200,
    toast: 300,
    tooltip: 400,
  },

  // --- Canvas/SVG Defaults ---
  canvas: {
    background: "#0F172A",
    gridColor: "#1E293B",
    lineWidth: 2,
    lineCap: "round" as CanvasLineCap,
    lineJoin: "round" as CanvasLineJoin,
  },
} as const;

export type Theme = typeof theme;

// --- Helper Functions ---
export function cssVar(name: string): string {
  return `var(--${name})`;
}

export function getPlayerColor(index: number): string {
  return theme.colors.player[index % theme.colors.player.length];
}

export function spacing(...values: (keyof typeof theme.spacing | number)[]): string {
  return values.map((v) => (typeof v === "number" ? `${v}px` : theme.spacing[v])).join(" ");
}