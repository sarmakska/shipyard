import next from "eslint-config-next";

/**
 * Flat ESLint configuration. eslint-config-next 16 ships native flat config, so
 * it is spread in directly rather than wrapped in FlatCompat.
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "next-env.d.ts",
      "*.config.ts",
      "*.config.mjs",
    ],
  },
  ...next,
];

export default config;
