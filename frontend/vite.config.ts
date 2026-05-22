import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy keeps frontend API calls aligned with backend routes during local development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": {
        target: "http://localhost:8080",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/v2": {
        target: "http://localhost:8080",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/healthz": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
