// Essai jetable : mesure le débit d'affichage de la Loupedeck Live.
import { LoupedeckLive } from 'loupedeck'

const DURATION_MS = 10_000
const CONNECT_TIMEOUT_MS = 10_000

// Remplit un buffer RGB565 little-endian d'une couleur unie.
function solid(width: number, height: number, rgb565: number): Buffer {
  const buf = Buffer.alloc(width * height * 2)
  for (let i = 0; i < buf.length; i += 2) buf.writeUInt16LE(rgb565, i)
  return buf
}

const COLORS = [0xf800, 0x07e0, 0x001f, 0xffe0] // rouge, vert, bleu, jaune

async function measure(
  label: string,
  width: number,
  height: number,
  x: number,
  y: number,
  device: LoupedeckLive,
): Promise<number> {
  const frames = COLORS.map((c) => solid(width, height, c))
  let count = 0
  const start = Date.now()
  while (Date.now() - start < DURATION_MS) {
    await device.drawBuffer(
      { id: 'left', x, y, width, height, autoRefresh: false },
      frames[count % frames.length],
    )
    await device.refresh('left')
    count++
  }
  const fps = count / ((Date.now() - start) / 1000)
  console.log(`${label} : ${count} images en ${DURATION_MS / 1000} s = ${fps.toFixed(1)} images/s`)
  return fps
}

const devices = (await LoupedeckLive.list()).filter(
  (d: { vendorId?: unknown; productId?: unknown }) =>
    Number(d.vendorId) === LoupedeckLive.vendorId && Number(d.productId) === LoupedeckLive.productId,
)
console.log('Appareils trouvés :', devices)
if (devices.length === 0) {
  console.error('Aucune Loupedeck Live trouvée. Branchez-la et fermez le logiciel Loupedeck / Logi Options+.')
  process.exit(2)
}

const device = new LoupedeckLive({ path: devices[0].path, autoConnect: false })
let code = 0
try {
  await Promise.race([
    device.connect(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Connexion impossible après ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS),
    ),
  ])
  console.log('Info :', await device.getInfo())
  await measure('Plein écran 480x270', 480, 270, 0, 0, device)
  await measure('Touche 90x90', 90, 90, 60, 0, device)
} catch (err) {
  console.error('Erreur :', err)
  code = 1
} finally {
  try {
    await device.close()
  } catch {
    // ignoré
  }
}
process.exit(code)
