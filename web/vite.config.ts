import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  test: {
    // Dates on screen and the zone sent to the API follow the browser, so the suite pins one.
    env: { TZ: "America/Sao_Paulo" },
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
