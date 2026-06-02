import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            Object.keys(req.headers).forEach(key => {
              if (key.toLowerCase() !== 'host') {
                proxyReq.setHeader(key, req.headers[key]!);
              }
            });
          });
        },
      },
    },
  },
});
