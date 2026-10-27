import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
const serviceWorker = readFileSync('dist/sw.js', 'utf8');
const html = readFileSync('dist/index.html', 'utf8');
const expectedIcons = [
  ['/steady-icon-192.png', 192, 'any'],
  ['/steady-icon-512.png', 512, 'any'],
  ['/steady-maskable-512.png', 512, 'maskable'],
];

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
for (const [src, size, purpose] of expectedIcons) {
  const icon = manifest.icons.find((entry) => entry.src === src);
  assert.ok(icon, `manifest must include ${src}`);
  assert.equal(icon.sizes, `${size}x${size}`);
  assert.equal(icon.purpose, purpose);
  assert.ok(existsSync(`dist${src}`));
  const metadata = await sharp(`dist${src}`).metadata();
  assert.equal(metadata.width, size);
  assert.equal(metadata.height, size);
}
assert.ok(html.includes('rel="apple-touch-icon"'));
assert.ok(existsSync('dist/apple-touch-icon.png'));
const apple = await sharp('dist/apple-touch-icon.png').metadata();
assert.equal(apple.width, 180);
assert.equal(apple.height, 180);

const precacheUrls = [...serviceWorker.matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]);
assert.ok(precacheUrls.includes('index.html'), 'the offline app shell must be precached');
assert.ok(precacheUrls.some((url) => url.endsWith('.js')));
assert.ok(precacheUrls.some((url) => url.endsWith('.css')));
assert.equal(new Set(precacheUrls).size, precacheUrls.length, 'precache entries must not be duplicated');
assert.ok(precacheUrls.every((url) => /\.(?:js|css|html|svg|png|ico|woff2|webmanifest)$/.test(url)),
  'precache may contain only public build assets');
assert.ok(precacheUrls.every((url) => !/(?:^|\/)(?:auth|rest|storage|realtime|functions|graphql|api)(?:\/|$)/.test(url)));
assert.ok(serviceWorker.includes('auth|rest|storage|realtime|functions|graphql|api'),
  'API/auth navigations must be excluded from the app-shell fallback');
assert.ok(!/(?:NetworkFirst|CacheFirst|StaleWhileRevalidate|BackgroundSyncPlugin)/.test(serviceWorker),
  'the app must not add runtime API caching or an offline write queue');

console.log(`PWA build policy: PASS (${precacheUrls.length} public precache entries, no API cache).`);
