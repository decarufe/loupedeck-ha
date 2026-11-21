// Déclaration minimale de la librairie `loupedeck` (JS pur, sans types) : seulement ce que l'application utilise.
declare module 'loupedeck' {
  export class LoupedeckLive {
    static readonly vendorId: number
    static readonly productId: number
    static list(o?: { ignoreSerial?: boolean; ignoreWebsocket?: boolean }): Promise<{ path: string; vendorId: number; productId: number }[]>
    constructor(o: { path: string; autoConnect?: boolean; reconnectInterval?: number })
    reconnectInterval: number
    on(e: string, cb: (p: any) => void): this
    removeAllListeners(e?: string): this
    connect(): Promise<unknown>
    close(): Promise<void> | undefined
    drawBuffer(o: { id: 'left'; x: number; y: number; width: number; height: number; autoRefresh: boolean }, b: Buffer): Promise<unknown> | undefined
    refresh(id: 'left'): Promise<unknown> | undefined
    setButtonColor(o: { id: number; color: string }): Promise<unknown> | undefined
    setBrightness(v: number): Promise<unknown> | undefined
    vibrate(p: number): Promise<unknown> | undefined
    getInfo(): Promise<{ serial: string; version: string }>
  }
}
