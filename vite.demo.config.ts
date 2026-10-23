import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pdfAssetsPlugin } from './server/pdf-assets-plugin.ts'
import { demoRepositoryPlugin } from './tools/demo-repository-plugin.mjs'

export default defineConfig({
  base: '/demo/',
  plugins: [
    {
      name: 'demo-entry',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = new URL(req.url ?? '/', 'http://demo.test')
          if (url.pathname === '/' || url.pathname === '/demo' || url.pathname === '/demo/') req.url = '/demo/demo.html' + url.search
          next()
        })
      },
    },
    react(), tailwindcss(), pdfAssetsPlugin(), demoRepositoryPlugin(),
  ],
  server: { host: '127.0.0.1', port: 4998, strictPort: true, open: '/demo/', watch: { ignored: ['**/.worktrees/**'] } },
  build: { outDir: 'dist-demo', rolldownOptions: { input: 'demo.html' } },
})
