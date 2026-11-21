import { EventEmitter } from 'node:events'
import type { LoupedeckLike } from '../../src/device/link.js'

export type ConnectMode = 'resolve' | 'hang' | 'reject'
export type DrawMode = 'resolve' | 'hang'

export interface FakeCall { method: string; args: unknown[] }

/** Fausse console : enregistre chaque appel, connect/drawBuffer réglables. */
export class FakeDevice extends EventEmitter implements LoupedeckLike {
  calls: FakeCall[] = []
  connectMode: ConnectMode
  drawMode: DrawMode
  /** drawBuffer lève une exception synchrone. */
  drawThrows = false
  reconnectInterval = 0
  info = { serial: 'FAKE0001', version: '0.2.5' }
  private held: (() => void)[] = []

  constructor(o: { connect?: ConnectMode; draw?: DrawMode } = {}) {
    super()
    this.connectMode = o.connect ?? 'resolve'
    this.drawMode = o.draw ?? 'resolve'
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  callsOf(method: string): FakeCall[] {
    return this.calls.filter((c) => c.method === method)
  }

  /** Libère tous les drawBuffer restés pendants. */
  releaseDraws(): void {
    const held = this.held
    this.held = []
    for (const res of held) res()
  }

  connect(): Promise<unknown> {
    this.record('connect', [])
    if (this.connectMode === 'hang') return new Promise(() => {})
    // La librairie rejette parfois avec une chaîne plutôt qu'une Error.
    if (this.connectMode === 'reject') return Promise.reject('Opening COM4: Access denied')
    return Promise.resolve()
  }

  close(): unknown {
    this.record('close', [])
    return undefined
  }

  drawBuffer(o: { id: 'left'; x: number; y: number; width: number; height: number; autoRefresh: false }, b: Buffer): Promise<unknown> | undefined {
    this.record('drawBuffer', [o, b])
    if (this.drawThrows) throw new Error('Expected buffer length of 1, got 2!')
    if (this.drawMode === 'hang') return new Promise<void>((res) => this.held.push(res))
    return Promise.resolve()
  }

  refresh(id: 'left'): Promise<unknown> | undefined {
    this.record('refresh', [id])
    return Promise.resolve()
  }

  setButtonColor(o: { id: number; color: string }): Promise<unknown> | undefined {
    this.record('setButtonColor', [o])
    return Promise.resolve()
  }

  setBrightness(v: number): Promise<unknown> | undefined {
    this.record('setBrightness', [v])
    return Promise.resolve()
  }

  vibrate(p: number): Promise<unknown> | undefined {
    this.record('vibrate', [p])
    return Promise.resolve()
  }

  getInfo(): Promise<{ serial: string; version: string }> {
    this.record('getInfo', [])
    return Promise.resolve(this.info)
  }
}
