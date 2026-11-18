import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work on any host and sub-path (GitHub Pages /voting/, Vercel, Firebase Hosting...)
export default defineConfig({
  plugins: [react()],
  base: './',
});
