import sharp from 'sharp';

const outputs = [
  ['public/steady-mark.svg', 192, 'public/steady-icon-192.png'],
  ['public/steady-mark.svg', 512, 'public/steady-icon-512.png'],
  ['public/steady-maskable.svg', 512, 'public/steady-maskable-512.png'],
  ['public/steady-maskable.svg', 180, 'public/apple-touch-icon.png'],
];

for (const [source, size, destination] of outputs) {
  await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(destination);
}

console.log('Generated regular, maskable, and Apple touch icons.');
