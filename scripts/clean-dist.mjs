#!/usr/bin/env node
/**
 * 왜 직접 재귀로 지우는가
 *   이 저장소 경로처럼 비ASCII 문자가 섞인 경로에서 Node v25 의
 *   `fs.rmSync(dir, { recursive: true })` 가 프로세스를 통째로 죽인다
 *   (Windows STATUS_STACK_BUFFER_OVERRUN, 0xC0000409).
 *   Vite 의 `emptyOutDir` 도 같은 API 를 쓰기 때문에 vite.config.ts 에서 꺼 두고
 *   빌드 전에 이 스크립트로 지운다.
 *
 *   node scripts/clean-dist.mjs [dir ...]
 */

import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 재귀 삭제. 심볼릭 링크는 따라가지 않고 링크 자체만 지운다. */
function removeRecursive(target) {
  if (!existsSync(target)) return;

  const stats = lstatSync(target);
  if (!stats.isDirectory()) {
    unlinkSync(target);
    return;
  }

  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(target, entry.name);
    if (entry.isDirectory()) {
      removeRecursive(child);
    } else {
      unlinkSync(child);
    }
  }
  rmdirSync(target);
}

const targets = process.argv.slice(2);
for (const dir of targets.length > 0 ? targets : ["dist"]) {
  const target = join(ROOT, dir);
  try {
    const existed = existsSync(target);
    removeRecursive(target);
    console.log(existed ? `정리: ${dir}/` : `건너뜀: ${dir}/ (없음)`);
  } catch (error) {
    console.error(`${dir}/ 를 지우지 못했습니다: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
