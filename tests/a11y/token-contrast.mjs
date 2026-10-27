import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
  .map(([, name, value]) => [name, value]));

function luminance(hex) {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

const textPairs = [
  ['green', 'paper'], ['green', 'white'], ['green', 'sage'],
  ['muted', 'paper'], ['muted', 'white'], ['muted', 'sage'],
  ['olive', 'paper'], ['olive', 'white'], ['olive', 'sage'],
];

for (const [foreground, background] of textPairs) {
  assert.ok(tokens[foreground] && tokens[background], `missing ${foreground}/${background} token`);
  const ratio = contrast(tokens[foreground], tokens[background]);
  assert.ok(ratio >= 4.5, `${foreground} on ${background} is ${ratio.toFixed(2)}:1; normal text needs 4.5:1`);
}

console.log(`Accessible text token pairs: PASS (${textPairs.length} at 4.5:1 or higher).`);
