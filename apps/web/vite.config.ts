import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { prodConfig } from '@podlet/config';



const apiUrl = 'VITE_API_URL' in process.env
  ? process.env.VITE_API_URL!
  : `http://localhost:${prodConfig.port}`;

export default defineConfig({
  plugins: [devtools(), solidPlugin(), tailwindcss()],
  server: {
    port: prodConfig.webPort,
  },
  build: {
    target: 'esnext',
  },
  define: {
    'process.env.API_URL': JSON.stringify(apiUrl),
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
  }
});
