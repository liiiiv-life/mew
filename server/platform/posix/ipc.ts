import fs from 'node:fs'
export const ipcEndpoint = (file: string) => file
export function removeEndpoint(endpoint: string): void { fs.rmSync(endpoint, { force: true }) }
