import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { prodConfig } from '@podlet/config';



// Docker builds set VITE_API_URL='' (relative paths, served same-origin by the
// gateway). Native dev falls back to '' as well: requests go through the dev
// proxy below, so remote machines reach the stack with no CORS involved.
const apiUrl = 'VITE_API_URL' in process.env
  ? process.env.VITE_API_URL!
  : '';

export default defineConfig({
  plugins: [devtools(), solidPlugin(), tailwindcss()],
  server: {
    port: prodConfig.webPort,
    // Bind all interfaces so the dev server is reachable on the LAN.
    host: true,
    // Relay API calls to the gateway server-side (dev server only — the
    // `server` block is ignored by `vite build`, which is what Docker runs).
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${prodConfig.port}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
  define: {
    'process.env.API_URL': JSON.stringify(apiUrl),
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
  }
});
