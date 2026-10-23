import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pdfAssetsPlugin } from './server/pdf-assets-plugin.ts'
import { startupCodeSplitting } from './server/startup-chunks.ts'

// https://vite.dev/config/
export default defineConfig({
  // Preloads, imports and workers must share the iframe's per-connection resource URL.
  base: './',
  build: { rolldownOptions: { output: { codeSplitting: startupCodeSplitting } } },
  plugins: [react(), tailwindcss(), pdfAssetsPlugin(), {
    name: 'docs-api',
    async configureServer(server) {
      // A URL import keeps native server dependencies out of Vite's config bundle.
      const { configureDocsServer } = await import(new URL('./server/plugin.ts', import.meta.url).href) as typeof import('./server/plugin.ts')
      configureDocsServer(server)
    },
  }],
  // 4999 = dev(HMR) 서버 — server/plugin.ts가 5000과 동일한 인증(미로그인 = 게스트)을 붙인다.
  // 그래도 HMR·소스맵 노출 때문에 tailnet 밖으로는 열지 않는다.
  // 프로덕션 서버(5000)는 server/serve.ts가 담당한다.
  server: {
    host: '0.0.0.0',
    port: 4999,
    strictPort: true,
    watch: { ignored: ['**/.worktrees/**'] },
  },
})
