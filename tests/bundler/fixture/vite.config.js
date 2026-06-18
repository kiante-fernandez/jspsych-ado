// Vite must not pre-bundle jspsych-ado, or its internal `new URL(..., import.meta.url)`
// asset/worker emission can be skipped (Vite #10837). This mirrors the README's
// "Using with a bundler" recipe.
export default {
  optimizeDeps: { exclude: ["jspsych-ado"] },
  build: { target: "es2022" },
};
