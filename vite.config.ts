import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { docsApiPlugin } from './server/plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), docsApiPlugin()],
  // 5000 = 편집용 dev 서버, 5001 = 읽기 전용 게스트 뷰어 (cloudflare tunnel로 노출)
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5001,
    strictPort: true,
    // tunnel 도메인의 Host 헤더를 허용 (특정 도메인으로 좁혀도 됨)
    allowedHosts: true,
  },
})
