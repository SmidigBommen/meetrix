// C firmware -> WebAssembly -> plain JS, bundled with the simulated parts into simulator.html
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('build', { recursive: true });
const c = readdirSync('firmware').filter(f => f.endsWith('.c')).map(f => 'firmware/' + f);
execFileSync('zig', ['cc', '-target', 'wasm32-freestanding', '-Os', '-Wall', '-Wextra', '-nostdlib', '-fno-builtin',
  '-Wl,--no-entry', '-o', 'build/firmware.wasm', ...c], { stdio: 'inherit' });
execFileSync('node_modules/.bin/wasm2js', ['build/firmware.wasm', '-O', '-o', 'build/fw.raw.js'], { stdio: 'inherit' });
const raw = readFileSync('build/fw.raw.js', 'utf8').replace(/^import .*$/gm, '');
const body = raw.slice(0, raw.indexOf('var retasmFunc'));
const fw = '// Generated from firmware/*.c by build.mjs\nfunction createFirmware(env) {\n' + body + '\nreturn asmFunc({ env });\n}\n';
writeFileSync('build/fw.mjs', fw + 'export { createFirmware };\n');
const sim = readFileSync('sim/sim.mjs', 'utf8').replace(/^export /gm, '');
const page = readFileSync('sim/page.html', 'utf8');
writeFileSync('simulator.html', page.replace('/*BUNDLE*/', () => fw + sim));
console.log('simulator.html', readFileSync('simulator.html').length, 'bytes; firmware', readFileSync('build/firmware.wasm').length, 'bytes');
