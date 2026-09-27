import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '../public/icon-source.jpg');
const publicDir = join(__dirname, '../public');

async function generateIcons() {
  const sizes = [
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon-32.png', size: 32 },
  ];

  for (const { name, size } of sizes) {
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(join(publicDir, name));
    console.log(`✅ Generated ${name} (${size}x${size})`);
  }
  console.log('🎉 All icons generated!');
}

generateIcons().catch(console.error);
