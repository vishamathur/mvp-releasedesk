import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        rd: {
          ink: "var(--rd-ink)",
          forest: "var(--rd-forest)",
          canopy: "var(--rd-canopy)",
          mist: "var(--rd-mist)",
          brass: "var(--rd-brass)",
          signal: "var(--rd-signal)",
          alert: "var(--rd-alert)",
          fog: "var(--rd-fog)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
