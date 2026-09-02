import { defineConfig } from "vite";
export default defineConfig({
  root: "/work",
  base: "/",
  configFile: false,
  build: {
    outDir: "/output/dist",
    emptyOutDir: true,
    cssTarget: "safari16.3",
  },
});
