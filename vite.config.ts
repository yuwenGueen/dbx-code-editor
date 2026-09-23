import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  base: "./",
  build: {
    outDir: "../ui",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
});
