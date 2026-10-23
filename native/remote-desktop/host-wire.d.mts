export function hostFrame(packet: Uint8Array): Buffer
export function hostReader(onMessage: (message: Record<string, any>) => void, onFrame: (packet: Buffer) => void): (chunk: Buffer) => void
