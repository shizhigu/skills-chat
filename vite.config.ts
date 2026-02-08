import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  ssr: {
    // Bundle e2b into server output so Vite handles its ESM/CJS conversion.
    // Without this, Vercel's Node.js runtime fails on e2b's require("chalk") (chalk v5 is ESM-only).
    noExternal: ["e2b"],
  },
});
