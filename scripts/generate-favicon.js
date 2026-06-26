import { writeFileSync } from "node:fs";
import { join } from "node:path";

const size = 32;
const pixels = Buffer.alloc(size * size * 4);

function setPixel(x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }
  const offset = (y * size + x) * 4;
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

function fillRect(x, y, width, height, rgba) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(xx, yy, rgba);
    }
  }
}

function fillCircle(cx, cy, radius, rgba) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(x, y, rgba);
      }
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function fillPolygon(points, rgba) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) {
        setPixel(x, y, rgba);
      }
    }
  }
}

const teal = [15, 118, 110, 255];
const white = [255, 255, 255, 255];

fillRect(0, 0, size, size, teal);
fillCircle(8, 8, 8, teal);
fillCircle(23, 8, 8, teal);
fillCircle(8, 23, 8, teal);
fillCircle(23, 23, 8, teal);
fillPolygon(
  [
    [16, 5],
    [24, 8],
    [24, 16],
    [22, 22],
    [16, 27],
    [10, 22],
    [8, 16],
    [8, 8]
  ],
  white
);
fillRect(12, 14, 8, 2, teal);
fillRect(12, 18, 8, 2, teal);
fillRect(12, 22, 8, 2, teal);

const xor = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const source = ((size - 1 - y) * size + x) * 4;
    const target = (y * size + x) * 4;
    xor[target] = pixels[source + 2];
    xor[target + 1] = pixels[source + 1];
    xor[target + 2] = pixels[source];
    xor[target + 3] = pixels[source + 3];
  }
}

const andMask = Buffer.alloc((size / 8) * size);
const bitmapHeader = Buffer.alloc(40);
bitmapHeader.writeUInt32LE(40, 0);
bitmapHeader.writeInt32LE(size, 4);
bitmapHeader.writeInt32LE(size * 2, 8);
bitmapHeader.writeUInt16LE(1, 12);
bitmapHeader.writeUInt16LE(32, 14);
bitmapHeader.writeUInt32LE(0, 16);
bitmapHeader.writeUInt32LE(xor.length + andMask.length, 20);

const imageData = Buffer.concat([bitmapHeader, xor, andMask]);
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry.writeUInt8(size, 0);
entry.writeUInt8(size, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(imageData.length, 8);
entry.writeUInt32LE(iconDir.length + entry.length, 12);

writeFileSync(join("public", "favicon.ico"), Buffer.concat([iconDir, entry, imageData]));
