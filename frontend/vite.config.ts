import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// T00 前端契约：dev server 固定 5173（strictPort，端口被占直接报错而不是自动漂移）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // /api 反代到自建后端：前端代码里只写相对路径 /api/**，换环境不改代码。
    //
    // changeOrigin 必须保持 false（http-proxy 默认值）：保持 false 时转发给后端的 Host
    // 仍是浏览器访问的 localhost:5173，后端才能把同源请求还原成白名单里的 Origin。
    // 改成 true 会让 Host 变成 localhost:4000，白名单比对直接失败。
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
