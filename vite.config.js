import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    root: 'frontend',
    envDir: process.cwd(),
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: (env.VITE_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean),
      proxy: {'/api': 'http://127.0.0.1:8017'},
    },
    build: {outDir: '../dist', emptyOutDir: true},
  };
});
