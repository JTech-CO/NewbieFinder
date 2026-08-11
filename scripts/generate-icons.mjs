#!/usr/bin/env node
/**
 * 외부 의존성 없이 node:zlib 만으로 RGBA PNG 를 직접 인코딩한다.
 * (원격 리소스나 빌드 타임 바이너리 의존을 늘리지 않는다)
 *
 * 디자인
 *   - 어두운 둥근 사각형 배경
 *   - 왼쪽 아래 원점에서 오른쪽 위로 퍼지는 레이더 아크 2개
 *   - 원점의 작은 점 = 아직 크게 노출되지 않은 라이브
 *
 * 금지
 *   - CHZZK 사선 로고 모사, 네이버 N 로고, 공식 인증처럼 보이는 체크마크
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "icons");
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

/* ---------------------------------------------------------------- */
/* 색                                                                */
/* ---------------------------------------------------------------- */

const BACKGROUND = [0x00, 0x00, 0x00];
const BORDER = [0x26, 0x26, 0x26];
const ACCENT = [0x00, 0xff, 0xa3];

/* ---------------------------------------------------------------- */
/* 도형 (0..1 정규화 좌표, y 는 아래로 증가)                          */
/* ---------------------------------------------------------------- */

/* 모서리는 알약이 아니라 "다듬은 사각형" 정도로만 둥글린다. */
const CORNER_RADIUS = 0.16;
/** 열린 원의 중심이자 "아직 발견되지 않은 작은 라이브"를 뜻하는 점의 위치 */
const ORIGIN = { x: 0.5, y: 0.5 };
const DOT_RADIUS = 0.082;
const ARCS = [
  { radius: 0.22, halfWidth: 0.042, alpha: 1 },
  { radius: 0.38, halfWidth: 0.042, alpha: 0.8 },
];
/**
 * 링을 닫지 않고 한 구간을 비운다. 완결된 원이 아니라 "탐색 중"을 뜻한다.
 * atan2(dy, dx) 기준 각도(도). y 가 아래로 증가하므로 양수 각도는 화면 아래쪽이다.
 */
const ARC_GAP_DEGREES = { from: 32, to: 92 };

function insideRoundedRect(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 한 샘플 지점의 색을 정한다. [r, g, b, a] (a 는 0..1)
 * 아크는 원점 기준 오른쪽 위 사분면(dx >= 0, dy <= 0)에만 그린다.
 */
function sample(x, y) {
  if (!insideRoundedRect(x, y, CORNER_RADIUS)) {
    return [0, 0, 0, 0];
  }

  const dx = x - ORIGIN.x;
  const dy = y - ORIGIN.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= DOT_RADIUS) {
    return [...ACCENT, 1];
  }

  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const inGap = degrees >= ARC_GAP_DEGREES.from && degrees <= ARC_GAP_DEGREES.to;

  if (!inGap) {
    for (const arc of ARCS) {
      if (Math.abs(distance - arc.radius) <= arc.halfWidth) {
        return [...ACCENT, arc.alpha];
      }
    }
  }

  // 여기까지 왔으면 둥근 사각형 안이다.
  // 바깥 테두리를 아주 얇게 넣어 어두운 배경 위에서도 형태가 남게 한다.
  return isNearEdge(x, y) ? [...BORDER, 1] : [...BACKGROUND, 1];
}

function isNearEdge(x, y) {
  const inset = 0.022;
  const inner = insideRoundedRect(
    (x - inset) / (1 - 2 * inset),
    (y - inset) / (1 - 2 * inset),
    CORNER_RADIUS,
  );
  return !inner;
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          const [sr, sg, sb, sa] = sample(x, y);
          // 프리멀티플라이드 누적 후 마지막에 되돌린다.
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const offset = (py * size + px) * 4;

      if (alpha <= 0) {
        pixels.writeUInt32BE(0, offset);
        continue;
      }

      pixels[offset] = Math.round(r / a);
      pixels[offset + 1] = Math.round(g / a);
      pixels[offset + 2] = Math.round(b / a);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/* ---------------------------------------------------------------- */
/* PNG 인코딩                                                        */
/* ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 각 스캔라인 앞에 filter type 0 을 붙인다.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, renderRgba(size));
  const target = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(target, png);
  console.log(`생성: public/icons/icon-${size}.png (${png.length.toLocaleString("ko-KR")} bytes)`);
}

console.log("아이콘 4종을 만들었습니다.");
