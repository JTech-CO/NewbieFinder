#!/usr/bin/env node
/**
 * dist 디렉터리를 배포용 ZIP 으로 묶는 스크립트.
 *
 *   release/newbie-finder-v<version>.zip
 *   release/checksums.txt   (SHA-256)
 *
 * 압축 라이브러리를 새로 들이지 않기 위해 ZIP 파일을 직접 작성한다.
 * 사용하는 것은 Node 표준 모듈뿐이다.
 *
 *   - node:zlib 의 deflateRawSync 로 각 엔트리를 압축한다. (ZIP 의 method 8 = deflate)
 *   - 압축이 이득이 없으면 그 엔트리는 무압축(method 0)으로 저장한다.
 *   - CRC-32 는 아래에서 직접 계산한다. (ZIP 스펙이 요구하는 IEEE 802.3 다항식)
 *
 * ZIP64 는 만들지 않는다. 확장 패키지가 4GB 를 넘을 일이 없고,
 * 넘는 상황이라면 압축이 아니라 빌드를 의심해야 하므로 그 자리에서 멈춘다.
 *
 * 실행: node scripts/package-extension.mjs   (npm run package)
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
const RELEASE_DIR = path.join(ROOT, "release");
const CHECKSUM_FILE = path.join(RELEASE_DIR, "checksums.txt");

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** 2.0: deflate 를 읽을 수 있는 최소 버전. */
const ZIP_VERSION = 20;
/** 범용 비트 플래그 11번: 파일 이름이 UTF-8 임을 알린다. */
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
/** 0o100644: 일반 파일, 소유자 rw / 그 외 r. */
const ZIP_UNIX_FILE_ATTRIBUTES = 0o100644 << 16;
const ZIP64_THRESHOLD = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;

// --- CRC-32 -----------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} 부호 없는 32비트 CRC
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- 보조 ------------------------------------------------------------------

/**
 * MS-DOS 형식 날짜·시각. ZIP 헤더가 요구하는 형식이라 어쩔 수 없이 쓴다.
 * @param {Date} date
 */
function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate: (((year - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} 바이트`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString("ko-KR")} 바이트)`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString("ko-KR")} 바이트)`;
}

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>} dist 기준 상대 경로 (구분자는 항상 /)
 */
async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

/**
 * @param {{ name: string, data: Buffer, modifiedAt: Date }[]} entries
 * @returns {{ archive: Buffer, stored: number, deflated: number }}
 */
function buildZip(entries) {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`엔트리가 ${ZIP_MAX_ENTRIES}개를 넘어 ZIP64 가 필요합니다. (현재 ${entries.length}개)`);
  }

  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  let offset = 0;
  let storedCount = 0;
  let deflatedCount = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;
    if (useDeflate) {
      deflatedCount += 1;
    } else {
      storedCount += 1;
    }

    if (entry.data.length > ZIP64_THRESHOLD || payload.length > ZIP64_THRESHOLD) {
      throw new Error(`${entry.name} 이(가) 4GB 를 넘습니다. 빌드 산출물을 확인해 주세요.`);
    }

    const { dosDate, dosTime } = toDosDateTime(entry.modifiedAt);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_HEADER_SIGNATURE, 0);
    // 상위 바이트 3 = UNIX. 아래 external attributes 를 UNIX 권한으로 해석하게 한다.
    centralHeader.writeUInt16LE((3 << 8) | ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(ZIP_UNIX_FILE_ATTRIBUTES >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuffer, payload);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + payload.length;

    if (offset > ZIP64_THRESHOLD) {
      throw new Error("압축 결과가 4GB 를 넘어 ZIP64 가 필요합니다. 빌드 산출물을 확인해 주세요.");
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endRecord.writeUInt16LE(0, 4); // 현재 디스크 번호
  endRecord.writeUInt16LE(0, 6); // 중앙 디렉터리가 시작하는 디스크 번호
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20); // 주석 길이

  return {
    archive: Buffer.concat([...localParts, centralDirectory, endRecord]),
    stored: storedCount,
    deflated: deflatedCount,
  };
}

/**
 * 기존 checksums.txt 를 유지하면서 이번 파일의 줄만 교체한다.
 * @param {string} fileName
 * @param {string} digest
 */
async function updateChecksums(fileName, digest) {
  /** @type {Map<string, string>} */
  const lines = new Map();
  try {
    const existing = await readFile(CHECKSUM_FILE, "utf8");
    for (const line of existing.split(/\r?\n/)) {
      const matched = /^([0-9a-f]{64})\s+(.+)$/i.exec(line.trim());
      if (matched && matched[1] && matched[2]) {
        lines.set(matched[2], matched[1].toLowerCase());
      }
    }
  } catch {
    // 아직 파일이 없으면 새로 만든다.
  }
  lines.set(fileName, digest);

  const body = [...lines.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n");
  await writeFile(CHECKSUM_FILE, `${body}\n`, "utf8");
}

async function main() {
  console.log("NewbieFinder 배포 패키지를 만듭니다.\n");

  let distInfo;
  try {
    distInfo = await stat(DIST_DIR);
  } catch {
    distInfo = null;
  }
  if (!distInfo || !distInfo.isDirectory()) {
    console.error("✗ dist 디렉터리가 없습니다. 먼저 `npm run build` 를 실행해 주세요.");
    process.exitCode = 1;
    return;
  }

  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const version = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

  const relativePaths = (await collectFiles(DIST_DIR)).sort((a, b) => a.localeCompare(b));
  if (relativePaths.length === 0) {
    console.error("✗ dist 가 비어 있습니다. 빌드가 정상적으로 끝났는지 확인해 주세요.");
    process.exitCode = 1;
    return;
  }
  if (!relativePaths.includes("manifest.json")) {
    console.error("✗ dist/manifest.json 이 없습니다. `npm run build` 를 다시 실행해 주세요.");
    process.exitCode = 1;
    return;
  }

  // manifest 버전과 package.json 버전이 다르면 잘못된 이름의 ZIP 이 나온다.
  const distManifest = JSON.parse(await readFile(path.join(DIST_DIR, "manifest.json"), "utf8"));
  if (distManifest.version !== version) {
    console.error(
      `✗ dist/manifest.json 의 버전(${String(distManifest.version)})이 package.json(${version})과 다릅니다.\n` +
        "  `npm run build` 를 다시 실행해 버전을 맞춰 주세요.",
    );
    process.exitCode = 1;
    return;
  }

  /** @type {{ name: string, data: Buffer, modifiedAt: Date }[]} */
  const entries = [];
  let rawTotal = 0;
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(DIST_DIR, ...relativePath.split("/"));
    const [data, info] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    entries.push({ name: relativePath, data, modifiedAt: info.mtime });
    rawTotal += data.length;
  }

  const { archive, stored, deflated } = buildZip(entries);

  await mkdir(RELEASE_DIR, { recursive: true });
  const zipFileName = `newbie-finder-v${version}.zip`;
  const zipPath = path.join(RELEASE_DIR, zipFileName);
  await writeFile(zipPath, archive);

  const digest = createHash("sha256").update(archive).digest("hex");
  await updateChecksums(zipFileName, digest);

  // 이미 압축된 파일(PNG 등)만 있으면 ZIP 헤더 때문에 100% 를 넘을 수 있다.
  const ratio = rawTotal > 0 ? ((archive.length / rawTotal) * 100).toFixed(1) : "0.0";

  console.log(`✓ 파일 ${entries.length}개를 담았습니다. (압축 ${deflated}개 / 무압축 ${stored}개)`);
  console.log(`✓ release/${zipFileName}`);
  console.log(`    크기      ${formatBytes(archive.length)}`);
  console.log(`    원본 합계 ${formatBytes(rawTotal)} (ZIP 은 원본의 ${ratio}%)`);
  console.log(`    SHA-256   ${digest}`);
  console.log(`✓ release/checksums.txt 에 체크섬을 기록했습니다.`);
  console.log("");
  console.log("chrome://extensions 에서 압축을 푼 dist 를 불러와 수동 회귀 테스트를 진행해 주세요.");
}

main().catch((error) => {
  console.error("✗ 패키징에 실패했습니다.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
