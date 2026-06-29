import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const fontsDir = join(root, 'public', 'fonts')
const outPath = join(root, 'public', 'og.png')

// Fail loudly rather than silently falling back to system fonts.
const requiredFonts = ['BebasNeue-Regular.ttf', 'DMSans.ttf', 'JetBrainsMono.ttf']
const missing = requiredFonts.filter((f) => !existsSync(join(fontsDir, f)))
if (missing.length) {
  console.error(
    `✗ Missing brand font(s) in public/fonts: ${missing.join(', ')}.\n` +
      '  The OG card must render in Bebas Neue / DM Sans / JetBrains Mono — refusing to fall back to system fonts.',
  )
  process.exit(1)
}

// Brand typography: render the real VynX fonts, not a system fallback.
//   Bebas Neue    (--font-display) -> VYNX wordmark + stat figures
//   DM Sans       (--font-body)    -> tagline subline
//   JetBrains Mono(--font-mono)    -> stat labels + footer
// libvips/librsvg resolves font families through fontconfig, so point it at the
// repo's committed font files BEFORE sharp loads libvips.
const fcRoot = join(tmpdir(), 'vynx-og-fontconfig')
mkdirSync(join(fcRoot, 'cache'), { recursive: true })
const fcConf = join(fcRoot, 'fonts.conf')
writeFileSync(
  fcConf,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir}</dir>
  <cachedir>${join(fcRoot, 'cache')}</cachedir>
</fontconfig>`,
)
process.env.FONTCONFIG_FILE = fcConf

const { default: sharp } = await import('sharp')

const W = 1200, H = 630

const DISPLAY = 'Bebas Neue'
const BODY = 'DM Sans'
const MONO = 'JetBrains Mono'

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}"
        fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Wordmark -->
  <text x="80" y="195" font-family="${DISPLAY}" font-weight="bold"
        font-size="96" fill="#FFFFFF">VYN</text>
  <text x="318" y="195" font-family="${DISPLAY}" font-weight="bold"
        font-size="96" fill="#C9A84C">X</text>

  <!-- Tagline -->
  <text x="80" y="255" font-family="${BODY}" font-size="22" fill="#666666">The clearing layer for the machine-to-machine economy</text>

  <!-- Separator -->
  <line x1="80" y1="300" x2="${W - 80}" y2="300"
        stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Dominance Matrix params -->
  <text x="80"  y="385" font-family="${DISPLAY}" font-weight="bold" font-size="44" fill="#FFFFFF">200ms</text>
  <text x="80"  y="415" font-family="${MONO}" font-size="13" fill="#C9A84C" letter-spacing="2">OFA WINDOW</text>

  <text x="380" y="385" font-family="${DISPLAY}" font-weight="bold" font-size="44" fill="#FFFFFF">10bps</text>
  <text x="380" y="415" font-family="${MONO}" font-size="13" fill="#C9A84C" letter-spacing="2">TAKE RATE</text>

  <text x="640" y="385" font-family="${DISPLAY}" font-weight="bold" font-size="44" fill="#FFFFFF">15min</text>
  <text x="640" y="415" font-family="${MONO}" font-size="13" fill="#C9A84C" letter-spacing="2">DEADLINE SHIELD</text>

  <text x="900" y="385" font-family="${DISPLAY}" font-weight="bold" font-size="44" fill="#FFFFFF">1.20x</text>
  <text x="900" y="415" font-family="${MONO}" font-size="13" fill="#C9A84C" letter-spacing="2">SHF THRESHOLD</text>

  <!-- Footer -->
  <text x="80" y="${H - 55}" font-family="${MONO}" font-size="13" fill="#444444">vynx.network</text>
  <text x="${W - 80}" y="${H - 55}" font-family="${MONO}" font-size="13" fill="#444444"
        text-anchor="end">NO RETAIL ACCESS · QUALIFIED COUNTERPARTIES ONLY</text>
</svg>`

mkdirSync(join(root, 'public'), { recursive: true })
await sharp(Buffer.from(svg)).png().toFile(outPath)
console.log('✓ public/og.png generated (1200×630)')
