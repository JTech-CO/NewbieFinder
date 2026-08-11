#!/usr/bin/env node
/**
 * public/manifest.json 자체는 Vite 의 publicDir 설정으로 이미 dist 에 복사된다.
 * 이 스크립트는 그 뒤에 실행된다.
 *
 * 하나라도 어긋나면 종료 코드 1 로 끝낸다. 빌드가 조용히 성공한 척하는 것을 막기 위해서다.
 *
 * 실행: node scripts/copy-manifest.mjs   (npm run build 의 마지막 단계)
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
const DIST_MANIFEST = path.join(DIST_DIR, "manifest.json");
const SOURCE_MANIFEST = path.join(ROOT, "public", "manifest.json");
const CONSTANTS_FILE = path.join(ROOT, "src", "shared", "constants.ts");

const REQUIRED_OUTPUTS = [
  { relativePath: "background.js", label: "Service Worker 번들" },
  { relativePath: "finder/index.html", label: "Finder 페이지" },
];

/** Chrome 이 허용하는 버전 형식: 마침표로 구분한 1~4개의 정수(각 0~65535). */
const VERSION_PATTERN = /^\d{1,5}(\.\d{1,5}){0,3}$/;

/** @type {string[]} */
const problems = [];

/**
 * @param {boolean} ok
 * @param {string} message
 */
function report(ok, message) {
  console.log(`${ok ? "✓" : "✗"} ${message}`);
  if (!ok) {
    problems.push(message);
  }
}

/** @param {string} absolutePath */
function toDisplayPath(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join("/");
}

/**
 * @param {string} absolutePath
 * @returns {Promise<{ exists: boolean, size: number }>}
 */
async function inspectFile(absolutePath) {
  try {
    const info = await stat(absolutePath);
    return { exists: info.isFile(), size: info.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

/** @param {string} version */
function isChromeCompatibleVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    return false;
  }
  return version.split(".").every((part) => Number(part) <= 65535);
}

async function main() {
  console.log("NewbieFinder 빌드 산출물 정리를 시작합니다.\n");

  // 1. package.json 버전 읽기 ------------------------------------------------
  const packageJsonRaw = await readFile(path.join(ROOT, "package.json"), "utf8");
  /** @type {{ version?: unknown }} */
  const packageJson = JSON.parse(packageJsonRaw);
  const version = packageJson.version;

  if (typeof version !== "string" || !isChromeCompatibleVersion(version)) {
    console.error(
      `✗ package.json 의 version 값(${String(version)})을 manifest 버전으로 쓸 수 없습니다.\n` +
        "  Chrome 은 마침표로 구분한 1~4개의 정수(각 0~65535)만 허용합니다. 예: 1.0.0",
    );
    process.exitCode = 1;
    return;
  }

  // 2. dist/manifest.json 존재 확인 -----------------------------------------
  const distManifest = await inspectFile(DIST_MANIFEST);
  if (!distManifest.exists) {
    const sourceManifest = await inspectFile(SOURCE_MANIFEST);
    console.error(`✗ ${toDisplayPath(DIST_MANIFEST)} 파일이 없습니다.`);
    if (sourceManifest.exists) {
      console.error(
        "  public/manifest.json 은 있지만 dist 로 복사되지 않았습니다.\n" +
          "  먼저 `npm run build` 로 Vite 빌드를 실행해 주세요. (publicDir 복사 단계가 필요합니다)",
      );
    } else {
      console.error(
        `  원본 ${toDisplayPath(SOURCE_MANIFEST)} 도 없습니다. manifest 원본부터 확인해 주세요.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  report(true, `${toDisplayPath(DIST_MANIFEST)} 을(를) 찾았습니다.`);

  // 3. manifest 버전 동기화 --------------------------------------------------
  const manifestRaw = await readFile(DIST_MANIFEST, "utf8");
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    console.error(
      `✗ ${toDisplayPath(DIST_MANIFEST)} 을(를) JSON 으로 읽지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  const previousVersion = typeof manifest.version === "string" ? manifest.version : "(없음)";
  manifest.version = version;
  await writeFile(DIST_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (previousVersion === version) {
    report(true, `manifest version 이 package.json 과 같습니다. (${version})`);
  } else {
    report(true, `manifest version 을 ${previousVersion} → ${version} 으로 맞췄습니다.`);
  }

  // 4. 빌드 산출물 확인 ------------------------------------------------------
  for (const output of REQUIRED_OUTPUTS) {
    const absolutePath = path.join(DIST_DIR, ...output.relativePath.split("/"));
    const info = await inspectFile(absolutePath);
    if (!info.exists) {
      report(false, `${output.label}(${output.relativePath})이(가) dist 에 없습니다.`);
    } else if (info.size === 0) {
      report(false, `${output.label}(${output.relativePath})이(가) 비어 있습니다.`);
    } else {
      report(true, `${output.label} 확인 (${output.relativePath}, ${info.size.toLocaleString("ko-KR")} 바이트)`);
    }
  }

  // 5. 소스 상수와의 버전 일치 여부 (경고) -----------------------------------
  try {
    const constantsSource = await readFile(CONSTANTS_FILE, "utf8");
    const matched = /EXTENSION_VERSION\s*=\s*["']([^"']+)["']/.exec(constantsSource);
    if (matched && matched[1] !== version) {
      console.log(
        `! src/shared/constants.ts 의 EXTENSION_VERSION(${matched[1]})이 package.json(${version})과 다릅니다.\n` +
          "  빌드는 계속 진행하지만 배포 전에 맞춰 주세요.",
      );
    }
  } catch {
    // 상수 파일을 읽지 못해도 빌드를 막지는 않는다.
  }

  console.log("");
  if (problems.length > 0) {
    console.error(`빌드 산출물 확인에 실패했습니다. 문제 ${problems.length}건:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error("\n`npm run build` 를 다시 실행하고 Vite 빌드 로그를 확인해 주세요.");
    process.exitCode = 1;
    return;
  }

  console.log(`빌드 산출물 확인을 마쳤습니다. (버전 ${version})`);
  console.log("다음 단계: npm run validate:manifest");
}

main().catch((error) => {
  console.error("✗ 예기치 못한 오류로 중단했습니다.");
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
