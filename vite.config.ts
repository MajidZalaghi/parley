import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// The app is served from https://<user>.github.io/parley/ (architecture §6).
const BASE = "/parley/";

export default defineConfig({
  base: BASE,
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        spikes: resolve(import.meta.dirname, "spikes/index.html"),
      },
    },
  },
  plugins: [
    VitePWA({
      // Updates apply only after the user accepts (requirements §9).
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Parley",
        short_name: "Parley",
        description: "Spaced-repetition trainer for BIM meeting English.",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        background_color: "#f6f5f1",
        theme_color: "#1f3a5f",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [/\/spikes\//],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
