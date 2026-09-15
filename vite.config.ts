import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { docsApiPlugin } from './server/plugin'
import { pdfAssetsPlugin } from './server/pdf-assets-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfAssetsPlugin(), docsApiPlugin()],
  // 4999 = dev(HMR) 서버 — server/plugin.ts가 5000과 동일한 인증(미로그인 = 게스트)을 붙인다.
  // 그래도 HMR·소스맵 노출 때문에 tailnet 밖으로는 열지 않는다.
  // 프로덕션 서버(5000)는 server/serve.ts가 담당한다.
  server: {
    host: '0.0.0.0',
    port: 4999,
    strictPort: true,
  },
})
