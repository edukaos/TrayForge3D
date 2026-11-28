// Regenera lib/three.bundle.min.js desde node_modules/three.
// Uso: npm install && npm run build:three
import { build } from 'esbuild';
import { readFileSync, copyFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('../node_modules/three/package.json', import.meta.url))).version;

await build({
  entryPoints: [new URL('./three-entry.js', import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: `/* three.js r${version.split('.')[1]} (${version}) + OrbitControls | MIT License | https://threejs.org */` },
  outfile: new URL('../lib/three.bundle.min.js', import.meta.url).pathname,
});
copyFileSync(new URL('../node_modules/three/LICENSE', import.meta.url), new URL('../lib/THREE-LICENSE.txt', import.meta.url));
console.log(`lib/three.bundle.min.js generado con three ${version}`);
