import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { prodConfig } from '@podlet/config';



export default defineConfig({
  plugins: [devtools(), solidPlugin(), tailwindcss()],
  server: {
    port: 3002,
  },
  build: {
    target: 'esnext',
  },
  define: {
    'process.env.API_URL': JSON.stringify(`http://localhost:${prodConfig.appPort}`)
  }
});
