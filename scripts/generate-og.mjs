import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'public', 'og.png')

const W = 1200, H = 630

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}"
        fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Wordmark -->
  <text x="80" y="195" font-family="sans-serif" font-weight="bold"
        font-size="96" fill="#FFFFFF">VYN</text>
  <text x="318" y="195" font-family="sans-serif" font-weight="bold"
        font-size="96" fill="#C9A84C">X</text>

  <!-- Tagline -->
  <text x="80" y="255" font-family="sans-serif" font-size="22" fill="#666666">The clearing layer for the machine-to-machine economy</text>

  <!-- Separator -->
  <line x1="80" y1="300" x2="${W - 80}" y2="300"
        stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Dominance Matrix params -->
  <text x="80"  y="385" font-family="sans-serif" font-weight="bold" font-size="44" fill="#FFFFFF">200ms</text>
  <text x="80"  y="415" font-family="sans-serif" font-size="13" fill="#C9A84C" letter-spacing="2">OFA WINDOW</text>

  <text x="380" y="385" font-family="sans-serif" font-weight="bold" font-size="44" fill="#FFFFFF">10bps</text>
  <text x="380" y="415" font-family="sans-serif" font-size="13" fill="#C9A84C" letter-spacing="2">TAKE RATE</text>

  <text x="640" y="385" font-family="sans-serif" font-weight="bold" font-size="44" fill="#FFFFFF">15min</text>
  <text x="640" y="415" font-family="sans-serif" font-size="13" fill="#C9A84C" letter-spacing="2">DEADLINE SHIELD</text>

  <text x="900" y="385" font-family="sans-serif" font-weight="bold" font-size="44" fill="#FFFFFF">1.20x</text>
  <text x="900" y="415" font-family="sans-serif" font-size="13" fill="#C9A84C" letter-spacing="2">SHF THRESHOLD</text>

  <!-- Footer -->
  <text x="80" y="${H - 55}" font-family="sans-serif" font-size="13" fill="#444444">vynx.network</text>
  <text x="${W - 80}" y="${H - 55}" font-family="sans-serif" font-size="13" fill="#444444"
        text-anchor="end">NO RETAIL ACCESS · QUALIFIED COUNTERPARTIES ONLY</text>
</svg>`

mkdirSync(join(__dirname, '..', 'public'), { recursive: true })
await sharp(Buffer.from(svg)).png().toFile(outPath)
console.log('✓ public/og.png generated (1200×630)')
