export type BrowserCapture = 'cpu' | 'heap' | 'coverage' | 'snapshot'
export interface BrowserAnalysisSnapshot {
  id: string; revision: number; closed: boolean; url: string; reason: string; busy: boolean
  frames: { id: string; name: string; url: string; line: number; column: number; scriptId: string }[]
  breakpoints: { id: string; kind: 'dom' | 'event' | 'xhr'; value: string; type?: string }[]
  capturing: BrowserCapture[]
  artifacts: { id: string; kind: BrowserCapture; time: number }[]
}
