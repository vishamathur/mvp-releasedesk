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
        nw: {
          navy: "var(--nw-navy)",
          ink: "var(--nw-ink)",
          steel: "var(--nw-steel)",
          teal: "var(--nw-teal)",
          sand: "var(--nw-sand)",
          paper: "var(--nw-paper)",
          accent: "var(--nw-accent)",
          danger: "var(--nw-danger)",
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
