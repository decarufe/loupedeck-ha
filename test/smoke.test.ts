import { describe, expect, it } from 'vitest'
import { LoupedeckLive } from 'loupedeck'
import { createCanvas } from '@napi-rs/canvas'

describe('dépendances', () => {
  it('expose les identifiants de la Loupedeck Live et un canvas fonctionnel', () => {
    expect(LoupedeckLive.productId).toBe(0x0004)
    expect(LoupedeckLive.vendorId).toBe(0x2ec2)
    expect(createCanvas(480, 270).width).toBe(480)
  })
})
