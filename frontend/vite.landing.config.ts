import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A public-only entry: never includes the authenticated Mango application.
export default defineConfig({
  root: "landing",
  plugins: [react()],
  build: { outDir: "../dist-landing", emptyOutDir: true },
});
