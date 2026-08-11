#!/usr/bin/env node
/**
 * dist/manifest.json 및 패키지 내용 검증 스크립트.
 *
 * 여기서 막으려는 것은 "권한이 조용히 늘어나는 일"과 "원격 코드가 섞여 들어오는 일"이다.
 * 검사 항목을 통과하지 못하면 종료 코드 1 로 끝나고, 배포 스크립트가 그 자리에서 멈춘다.
 *
 * 실행: node scripts/validate-manifest.mjs   (npm run validate:manifest)
 */

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
const DIST_MANIFEST = path.join(DIST_DIR, "manifest.json");

/** 허용하는 권한. */
const ALLOWED_PERMISSIONS = ["declarativeContent", "storage"];

/** 허용하는 호스트 권한. 데이터 소스 한 곳뿐이다. */
const ALLOWED_HOST_PERMISSIONS = ["https://api.chzzk.naver.com/*"];

/** manifest 가 참조하는 아이콘 4종. */
const REQUIRED_ICON_SIZES = ["16", "32", "48", "128"];

/** Finder 페이지 경로. src/shared/constants.ts 의 FINDER_PAGE_PATH 와 같아야 한다. */
const FINDER_PAGE_PATH = "finder/index.html";

/**
 * 번들 안에 문자열로 남아 있어도 되는 원격 호스트.
 * "코드를 내려받는" 용도가 아니라는 점이 확인된 것만 넣는다.
 */
const ALLOWED_URL_HOSTS = [
  { host: "api.chzzk.naver.com", reason: "데이터 소스 API" },
  { host: "chzzk.naver.com", reason: "결과 카드가 여는 라이브 페이지 링크" },
  { host: "*.pstatic.net", reason: "썸네일 이미지 호스트 (CSP img-src 와 동일 범위)" },
  { host: "*.akamaized.net", reason: "썸네일 이미지 호스트 (CSP img-src 와 동일 범위)" },
  { host: "www.w3.org", reason: "SVG·XHTML 네임스페이스 문자열 (네트워크 요청 아님)" },
  { host: "react.dev", reason: "React 오류 안내 문서 URL 문자열 (네트워크 요청 아님)" },
];

/** 번들에 있으면 안 되는 원격 코드·동적 실행 패턴. */
const FORBIDDEN_CODE_PATTERNS = [
  { label: "importScripts() 호출", pattern: /importScripts\s*\(/ },
  { label: "원격 URL 동적 import()", pattern: /\bimport\s*\(\s*["'`]https?:\/\//i },
  { label: "원격 URL Worker 생성", pattern: /new\s+(?:Shared)?Worker\s*\(\s*["'`]https?:\/\//i },
  { label: "원격 URL 을 src 로 대입", pattern: /\.src\s*=\s*["'`]https?:\/\//i },
  { label: "eval() 호출", pattern: /(?<![.\w$])eval\s*\(/ },
  { label: "new Function() 호출", pattern: /new\s+Function\s*\(/ },
];

/** @type {{ ok: boolean, label: string, detail: string }[]} */
const results = [];

/**
 * @param {boolean} ok
 * @param {string} label
 * @param {string} [detail]
 */
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 순서와 무관하게 문자열 배열이 정확히 같은지 본다.
 * @param {unknown} value
 * @param {string[]} expected
 */
function matchesExactly(value, expected) {
  if (!Array.isArray(value)) {
    return { ok: false, missing: expected, extra: [] };
  }
  const actual = value.map((item) => String(item));
  const missing = expected.filter((item) => !actual.includes(item));
  const extra = actual.filter((item) => !expected.includes(item));
  return { ok: missing.length === 0 && extra.length === 0 && actual.length === expected.length, missing, extra };
}

/** @param {string} absolutePath */
async function fileExists(absolutePath) {
  try {
    const info = await stat(absolutePath);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * dist 하위 파일 목록을 재귀적으로 모은다.
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

/** @param {string} host */
function isAllowedHost(host) {
  const lowered = host.toLowerCase();
  return ALLOWED_URL_HOSTS.some((entry) =>
    entry.host.startsWith("*.")
      ? lowered === entry.host.slice(2) || lowered.endsWith(entry.host.slice(1))
      : lowered === entry.host,
  );
}

/** @param {Record<string, unknown>} manifest */
function validateManifest(manifest) {
  check(manifest.manifest_version === 3, "manifest_version 이 3 입니다.", `현재 값: ${String(manifest.manifest_version)}`);

  const permissions = matchesExactly(manifest.permissions, ALLOWED_PERMISSIONS);
  check(
    permissions.ok,
    `permissions 가 정확히 [${ALLOWED_PERMISSIONS.join(", ")}] 입니다.`,
    permissions.ok
      ? ""
      : `누락: ${permissions.missing.join(", ") || "없음"} / 초과: ${permissions.extra.join(", ") || "없음"}`,
  );

  const hostPermissions = matchesExactly(manifest.host_permissions, ALLOWED_HOST_PERMISSIONS);
  check(
    hostPermissions.ok,
    `host_permissions 가 정확히 [${ALLOWED_HOST_PERMISSIONS.join(", ")}] 입니다.`,
    hostPermissions.ok
      ? ""
      : `누락: ${hostPermissions.missing.join(", ") || "없음"} / 초과: ${hostPermissions.extra.join(", ") || "없음"}`,
  );

  check(
    manifest.optional_permissions === undefined && manifest.optional_host_permissions === undefined,
    "선택 권한(optional_permissions)이 없습니다.",
    "선택 권한도 사용자에게는 권한 요청으로 보입니다.",
  );

  const action = isPlainObject(manifest.action) ? manifest.action : null;
  check(action !== null, "action 항목이 있습니다.");
  check(
    action === null || action.default_popup === undefined,
    "action 에 default_popup 이 없습니다.",
    "아이콘 클릭은 팝업이 아니라 확장 내부 페이지를 엽니다.",
  );

  check(
    manifest.content_scripts === undefined,
    "content_scripts 가 없습니다.",
    "치지직 페이지에 코드를 주입하지 않습니다.",
  );
  check(
    manifest.web_accessible_resources === undefined,
    "web_accessible_resources 가 없습니다.",
    "확장 리소스를 웹 페이지에 노출하지 않습니다.",
  );

  /*
   * default_locale 을 선언하면 Chrome 은 _locales/<locale>/messages.json 을 요구하고,
   * 없으면 확장 자체를 로드하지 않는다. 빌드는 통과하는데 설치만 실패하는 유형이라
   * 여기서 반드시 잡아야 한다. (E2E 에서 실제로 확장 로드 실패로 드러났던 문제)
   */
  const defaultLocale = manifest.default_locale;
  if (defaultLocale === undefined) {
    check(true, "default_locale 을 선언하지 않았습니다.", "_locales 디렉터리가 필요 없습니다.");
  } else {
    const messagesPath = path.join(DIST_DIR, "_locales", String(defaultLocale), "messages.json");
    check(
      existsSync(messagesPath),
      `default_locale "${defaultLocale}" 에 대응하는 _locales 파일이 있습니다.`,
      `없으면 Chrome 이 확장을 로드하지 않습니다. 필요한 경로: _locales/${defaultLocale}/messages.json`,
    );
  }

  const background = isPlainObject(manifest.background) ? manifest.background : null;
  check(
    background !== null && background.service_worker === "background.js",
    'background.service_worker 가 "background.js" 입니다.',
    background === null ? "background 항목이 없습니다." : `현재 값: ${String(background.service_worker)}`,
  );
  check(
    background !== null && background.type === "module",
    'background.type 이 "module" 입니다.',
    background === null ? "background 항목이 없습니다." : `현재 값: ${String(background.type)}`,
  );

  const csp = isPlainObject(manifest.content_security_policy) ? manifest.content_security_policy : null;
  const extensionPagesCsp = csp && typeof csp.extension_pages === "string" ? csp.extension_pages : "";
  check(extensionPagesCsp.length > 0, "content_security_policy.extension_pages 가 선언되어 있습니다.");
  check(
    !extensionPagesCsp.includes("unsafe-eval"),
    "CSP 에 'unsafe-eval' 이 없습니다.",
    extensionPagesCsp.includes("unsafe-eval") ? "동적 코드 실행을 허용하면 안 됩니다." : "",
  );
  check(
    !extensionPagesCsp.includes("unsafe-inline"),
    "CSP 에 'unsafe-inline' 이 없습니다.",
    extensionPagesCsp.includes("unsafe-inline") ? "인라인 스크립트·스타일을 허용하면 안 됩니다." : "",
  );
  check(
    extensionPagesCsp.includes("script-src 'self'"),
    "CSP 가 script-src 'self' 를 선언합니다.",
    extensionPagesCsp.length > 0 ? `현재 값: ${extensionPagesCsp}` : "",
  );
  check(
    csp === null || csp.sandbox === undefined,
    "CSP 에 sandbox 정책이 없습니다.",
    "샌드박스 페이지는 사용하지 않습니다.",
  );
}

/** @param {Record<string, unknown>} manifest */
async function validateAssets(manifest) {
  const icons = isPlainObject(manifest.icons) ? manifest.icons : null;
  if (icons === null) {
    check(false, "icons 4종이 dist 에 있습니다.", "manifest 에 icons 항목이 없습니다.");
  } else {
    /** @type {string[]} */
    const missing = [];
    for (const size of REQUIRED_ICON_SIZES) {
      const relativePath = icons[size];
      if (typeof relativePath !== "string") {
        missing.push(`${size}px (manifest 에 선언 없음)`);
        continue;
      }
      const exists = await fileExists(path.join(DIST_DIR, ...relativePath.split("/")));
      if (!exists) {
        missing.push(`${size}px → ${relativePath}`);
      }
    }
    check(
      missing.length === 0,
      `아이콘 ${REQUIRED_ICON_SIZES.join("/")}px 파일이 dist 에 있습니다.`,
      missing.length === 0 ? "" : `없는 파일: ${missing.join(", ")}`,
    );
  }

  const finderExists = await fileExists(path.join(DIST_DIR, ...FINDER_PAGE_PATH.split("/")));
  check(finderExists, `Finder 페이지(${FINDER_PAGE_PATH})가 dist 에 있습니다.`);

  const workerExists = await fileExists(path.join(DIST_DIR, "background.js"));
  check(workerExists, "Service Worker(background.js)가 dist 에 있습니다.");
}

/** @param {string[]} files */
async function validateBundleContents(files) {
  const scanTargets = files.filter((file) => file.endsWith(".js") || file.endsWith(".html"));

  /** @type {string[]} */
  const forbiddenHits = [];
  /** @type {string[]} */
  const remoteRefHits = [];
  /** @type {string[]} */
  const inlineHits = [];
  /** @type {Map<string, Set<string>>} */
  const foreignHosts = new Map();

  for (const relativePath of scanTargets) {
    const source = await readFile(path.join(DIST_DIR, ...relativePath.split("/")), "utf8");

    for (const rule of FORBIDDEN_CODE_PATTERNS) {
      if (rule.pattern.test(source)) {
        forbiddenHits.push(`${relativePath} → ${rule.label}`);
      }
    }

    if (relativePath.endsWith(".html")) {
      const remoteTagPattern =
        /<(script|link|iframe|object|embed)\b[^>]*?\b(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
      for (const match of source.matchAll(remoteTagPattern)) {
        remoteRefHits.push(`${relativePath} → <${match[1]}> ${match[2]}`);
      }

      const inlineScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      for (const match of source.matchAll(inlineScriptPattern)) {
        const attributes = match[1] ?? "";
        const body = match[2] ?? "";
        if (!/\bsrc\s*=/i.test(attributes) && body.trim().length > 0) {
          inlineHits.push(`${relativePath} → 인라인 <script>`);
        }
      }
      if (/<style\b[^>]*>[\s\S]*?\S[\s\S]*?<\/style>/i.test(source)) {
        inlineHits.push(`${relativePath} → 인라인 <style>`);
      }
    }

    for (const match of source.matchAll(/https?:\/\/[^\s"'`)<>\\]+/gi)) {
      const raw = match[0];
      let host = "";
      try {
        host = new URL(raw).host;
      } catch {
        continue;
      }
      if (host.length === 0 || isAllowedHost(host)) {
        continue;
      }
      const bucket = foreignHosts.get(host) ?? new Set();
      bucket.add(relativePath);
      foreignHosts.set(host, bucket);
    }
  }

  check(
    forbiddenHits.length === 0,
    "번들에 원격 코드 로드·동적 실행 패턴이 없습니다.",
    forbiddenHits.length === 0 ? `검사한 파일 ${scanTargets.length}개` : forbiddenHits.join(" / "),
  );
  check(
    remoteRefHits.length === 0,
    "HTML 에 외부 스크립트·스타일 참조가 없습니다.",
    remoteRefHits.length === 0 ? "" : remoteRefHits.join(" / "),
  );
  check(
    inlineHits.length === 0,
    "HTML 에 인라인 <script>·<style> 가 없습니다.",
    inlineHits.length === 0 ? "" : `${inlineHits.join(" / ")} (CSP 'self' 에서 차단됩니다)`,
  );
  check(
    foreignHosts.size === 0,
    "번들의 http(s) 문자열이 허용 호스트 안에 있습니다.",
    foreignHosts.size === 0
      ? `허용 호스트: ${ALLOWED_URL_HOSTS.map((entry) => entry.host).join(", ")}`
      : [...foreignHosts.entries()]
          .map(([host, where]) => `${host} (${[...where].join(", ")})`)
          .join(" / "),
  );
}

async function main() {
  console.log("NewbieFinder manifest·패키지 검증을 시작합니다.\n");

  if (!(await fileExists(DIST_MANIFEST))) {
    console.error("✗ dist/manifest.json 이 없습니다. 먼저 `npm run build` 를 실행해 주세요.");
    process.exitCode = 1;
    return;
  }

  const manifestRaw = await readFile(DIST_MANIFEST, "utf8");
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    console.error(
      `✗ dist/manifest.json 을 JSON 으로 읽지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  validateManifest(manifest);
  await validateAssets(manifest);
  await validateBundleContents(await collectFiles(DIST_DIR));

  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.label}`);
    if (result.detail.length > 0 && (!result.ok || process.env.NF_VERBOSE === "1")) {
      console.log(`    ${result.detail}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log("");
  console.log(`검사 ${results.length}건 중 통과 ${results.length - failed.length}건, 실패 ${failed.length}건`);

  if (failed.length > 0) {
    console.error("\n검증에 실패했습니다. 위의 ✗ 항목을 고친 뒤 다시 실행해 주세요.");
    process.exitCode = 1;
    return;
  }

  console.log("manifest 와 패키지 내용이 정책을 만족합니다.");
  console.log("다음 단계: npm run package");
}

main().catch((error) => {
  console.error("✗ 예기치 못한 오류로 중단했습니다.");
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
