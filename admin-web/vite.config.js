import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Mode WiFi (jalankan-lokal-wifi.bat): VITE_API_URL=/api, jadi web
    // memanggil /api di alamatnya sendiri dan Vite meneruskannya ke server
    // API di laptop ini — sama seperti rewrite /api Vercel di hosting.
    // Perangkat lain di WiFi cukup menjangkau port web; ws untuk realtime.
    // Mode biasa (VITE_API_URL=http://localhost:3000/api) tidak memakainya.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
})
