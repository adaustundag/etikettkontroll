/**
 * PWA icon pipeline: cuts /tmp/ek-icon-raw.png (1024x1024) into all sizes.
 * Run: bun scripts/make-icons.ts
 * Re-generate the raw icon with: z-ai image -p "<prompt>" -o /tmp/ek-icon-raw.png -s 1024x1024
 */
import sharp from 'sharp'
import fs from 'node:fs'

const RAW = '/tmp/ek-icon-raw.png'
const OUT = 'public/icons'

fs.mkdirSync(OUT, { recursive: true })

// Sample the background colour from the top-left corner (for maskable padding)
const { channels } = await sharp(RAW).extract({ left: 0, top: 0, width: 12, height: 12 }).stats()
const bg = {
  r: Math.round(channels[0].mean),
  g: Math.round(channels[1].mean),
  b: Math.round(channels[2].mean),
}

// Standard icons: full-bleed square (OS applies its own mask)
await sharp(RAW).resize(512, 512).png().toFile(`${OUT}/icon-512.png`)
await sharp(RAW).resize(192, 192).png().toFile(`${OUT}/icon-192.png`)

// Apple touch icon: iOS rounds the corners itself
await sharp(RAW).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`)

// Maskable: content shrunk into the ~82% safe zone on a solid brand canvas
// (sharp applies resize BEFORE composite in a pipeline, so do it at final size)
const inner = await sharp(RAW).resize(420, 420).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
  .composite([{ input: inner, left: 46, top: 46 }])
  .png()
  .toFile(`${OUT}/maskable-512.png`)

console.log('icons written to', OUT, '| maskable bg:', bg)
