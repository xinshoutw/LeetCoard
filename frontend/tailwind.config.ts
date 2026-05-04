import type { Config } from "tailwindcss";

// GDG / Google brand palette — cool blue dominant, warm accents for highlights.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Google brand
        "g-blue":   "#4285F4",
        "g-red":    "#EA4335",
        "g-yellow": "#FBBC04",
        "g-green":  "#34A853",
        // GDG dark stage colours (deep navy + glass surfaces)
        stage: {
          900: "#070b1f",
          800: "#0d1330",
          700: "#141b3d",
          600: "#1c244e",
          500: "#252e62",
        },
        ink: {
          100: "#f4f6ff",
          200: "#cdd4ee",
          300: "#9aa3c7",
          400: "#5e6896",
        },
      },
      fontFamily: {
        display: [
          "Google Sans",
          "Product Sans",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Roboto Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 32px rgba(66,133,244,0.45)",
        "glow-warm": "0 0 32px rgba(251,188,4,0.45)",
        "glow-green": "0 0 32px rgba(52,168,83,0.45)",
      },
      keyframes: {
        idleBob: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-3px)" },
        },
        floorScroll: {
          "0%": { backgroundPositionY: "0px" },
          "100%": { backgroundPositionY: "120px" },
        },
        ringPulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(66,133,244,0.6)" },
          "100%": { boxShadow: "0 0 0 18px rgba(66,133,244,0)" },
        },
      },
      animation: {
        "idle-bob": "idleBob 1.6s ease-in-out infinite",
        "floor-scroll": "floorScroll 4s linear infinite",
        "ring-pulse": "ringPulse 1.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
