import { build } from 'esbuild';
await build({ entryPoints: ['frontend/app.js', 'frontend/sketch-preview.js', 'frontend/sketch-icons.js', 'frontend/morphing-controls.js'], bundle: true, minify: true, format: 'esm', outdir: 'static', logLevel: 'info' });
