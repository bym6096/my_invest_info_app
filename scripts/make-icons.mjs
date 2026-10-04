// 의존성 없이 PNG 아이콘 생성: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [24, 27, 33];
const BARS = [[59, 130, 246], [234, 179, 8], [22, 163, 74]]; // 파랑·노랑·초록 막대

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// safe: 마스커블 아이콘용으로 내용을 중앙 80% 안에 배치
function png(size, { safe }) {
  const px = Buffer.alloc(size * (size * 3 + 1));
  const pad = safe ? 0.2 : 0.12;
  const x0 = size * pad, w = size * (1 - 2 * pad), base = size * (1 - pad);
  const heights = [0.45, 0.75, 0.95];
  for (let y = 0; y < size; y++) {
    px[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let c = BG;
      const slot = w / 5; // 막대 3개 + 간격 2개
      for (let i = 0; i < 3; i++) {
        const bx = x0 + i * slot * 2;
        const top = base - (base - size * pad) * heights[i];
        if (x >= bx && x < bx + slot && y >= top && y < base) c = BARS[i];
      }
      px.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../public/icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), png(192, { safe: false }));
writeFileSync(new URL("icon-512.png", out), png(512, { safe: false }));
writeFileSync(new URL("maskable-512.png", out), png(512, { safe: true }));
writeFileSync(new URL("apple-touch-icon.png", out), png(180, { safe: false }));
