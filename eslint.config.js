import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "release/**", "coverage/**", "node_modules/**", "playwright-report/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        chrome: "readonly",
        __DEV__: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // 보안 규칙 — 백서 8.1
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": ["warn", { allow: ["debug", "warn", "error"] }],
      "no-restricted-properties": [
        "error",
        {
          property: "innerHTML",
          message: "innerHTML 을 사용하지 않습니다. React 텍스트 노드로 렌더링하세요. (백서 8.1)",
        },
        {
          property: "dangerouslySetInnerHTML",
          message: "dangerouslySetInnerHTML 을 사용하지 않습니다. (백서 8.1)",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "chrome.storage 래퍼를 사용하세요. (백서 2.5.1)" },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // 도메인 계층은 Chrome API, React, 네트워크 구현을 몰라야 한다. (백서 6.1)
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "zod"], message: "도메인 계층은 UI/검증 라이브러리를 import 하지 않습니다." },
            { group: ["../infrastructure/*", "../application/*"], message: "도메인은 상위 계층을 import 하지 않습니다." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "chrome", message: "도메인 계층은 Chrome API 를 사용하지 않습니다." },
        { name: "fetch", message: "도메인 계층은 네트워크를 호출하지 않습니다." },
      ],
    },
  },
  {
    // Playwright 픽스처의 `use` 는 React 의 use 훅이 아니다. 규칙이 오탐한다.
    files: ["tests/e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.mts", "*.config.{ts,js}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },
);
