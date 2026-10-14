import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// base 使用相對路徑 './'：
// 搭配 Hash 路由（#/...），同一份建置結果可以放在
// GitHub Pages 的子路徑（/foreign-invoice/）或 Capacitor App 裡，都不用改設定。
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: '旅遊發票',
        short_name: '旅遊發票',
        description: '拍照記錄旅遊發票，翻譯、統計、匯出 Excel',
        lang: 'zh-TW',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f766e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 只快取網站本身的檔案；Supabase 的資料不快取，避免看到舊資料
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      },
    }),
  ],
})
