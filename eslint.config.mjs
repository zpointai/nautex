import nextPlugin from "eslint-config-next";

const eslintConfig = [
  ...nextPlugin,
  {
    ignores: ["node_modules/**", ".next/**", ".desktop-build/**", ".codex-temp/**", "out/**", "dist/**", "releases/**"],
  },
];

export default eslintConfig;
