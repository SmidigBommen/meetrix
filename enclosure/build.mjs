// Runs the checks, then writes STL files and the 3D viewer page.
import jscad from '@jscad/modeling';
import { readFileSync, writeFileSync } from 'node:fs';
import { P, shell, backPlate, key, paint, forPrint, bought, dims } from './box.mjs';
import { repair, stl, pressAnywhere } from './check.mjs';
import { createFirmware } from '../build/fw.mjs';
import { Sim, loadState } from '../sim/sim.mjs';
const { measureBoundingBox, measureVolume } = jscad.measurements;
const { intersect } = jscad.booleans;
const { translate } = jscad.transforms;
const here = new URL('.', import.meta.url).pathname;
const fail = [];
const check = (name, ok, detail = '') => { console.log((ok ? 'ok    ' : 'FAIL  ') + name + (detail ? ': ' + detail : '')); if (!ok) fail.push(name); };
const overlap = (a, b) => measureVolume(intersect(a, b));

// Seen from the front, +x is on the left.
const parts = { shell: shell(), backPlate: backPlate(), keyPlus: key(1, true), keyMinus: key(-1, false) };
const extra = Object.fromEntries(Object.entries(bought).map(([k, f]) => [k, f()]));
const all = { ...parts, ...extra }, names = Object.keys(all);
const hits = [];
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const v = overlap(all[names[i]], all[names[j]]); if (v > 0.5) hits.push(names[i] + '/' + names[j] + ' ' + v.toFixed(1) + ' mm3'); }
check('no parts collide at rest', !hits.length, hits.join(', '));
for (const k of ['keyPlus', 'keyMinus']) {
  const moved = dy => translate([0, dy, 0], parts[k]), fixed = ['shell', 'backPlate', 'panel', 'diffuser', 'board'];
  check(k + ' moves down ' + P.reveal + ' mm without touching', fixed.every(n => overlap(moved(-P.reveal + 0.02), all[n]) < 0.1));
  check(k + ' reaches the switches', overlap(moved(-P.padPlay - 0.1), extra.switches) > 0.1 && overlap(moved(-P.padPlay + 0.05), extra.switches) < 0.01);
  check(k + ' is held by its hooks', overlap(moved(P.hookPlay + 0.3), parts.shell) > 0.5);
}
for (const play of [P.hookPlay, 2 * P.hookPlay]) { const r = pressAnywhere(play); check('press anywhere, hook play ' + play + ' mm', r.share === 1, Math.round(r.share * 100) + '% of points click, at most ' + r.travel.toFixed(2) + ' mm travel'); }
const strain = 3 * P.leg * (P.barb - P.slotGap) / (2 * (dims.keyTopY - P.keyTop - (dims.caseTop - P.wall)) ** 2) * 100;
check('hook bends less than 2% when snapped in', strain < 2, strain.toFixed(1) + '%');
check('no view through the gap under the keys', P.rimUp > 0 && overlap(parts.shell, jscad.primitives.cuboid({ size: [1, 0.1, P.D], center: [dims.keyCx, dims.caseTop + P.reveal, dims.keyCz] })) > 0.2);
check('keys cover the top', 2 * dims.keyW / P.W > 0.99, (2 * dims.keyW / P.W * 100).toFixed(1) + '% of the width, full depth');

const size = g => { const [a, b] = measureBoundingBox(g); return b.map((v, i) => +(v - a[i]).toFixed(1)); };
const info = {};
for (const [name, g] of [['shell', parts.shell], ['back-plate', forPrint.backPlate(parts.backPlate)], ['key-plus', forPrint.key(parts.keyPlus)], ['key-minus', forPrint.key(parts.keyMinus)]]) {
  const m = repair(g);
  check(name + ' is watertight', m.leaks === 0, m.leaks + ' open edges');
  info[name] = { size: size(g), cm3: +(measureVolume(g) / 1000).toFixed(1) };
  writeFileSync(here + 'stl/' + name + '.stl', stl(m.tris));
  console.log('      ' + info[name].size.join(' x ') + ' mm, ' + info[name].cm3 + ' cm3');
}

const mesh = g => Buffer.from(new Float32Array(repair(g).tris.flat(2)).buffer).toString('base64');
// One frame from the real firmware, as light per LED
const sim = new Sim(createFirmware); loadState(sim, 3); sim.power(true); sim.run(3e9);
sim.acc.fill(0); const t0 = sim.t; sim.run(t0 + 2e7);
const leds = Array.from(sim.acc, v => Math.round(Math.min(1, v / (sim.t - t0) * 16 / 0.9 * 1.4) * 255));
const shown = { ...all, paintPlus: paint(1, true), paintMinus: paint(-1, false) };
const data = { P, dims, info, leds, mesh: Object.fromEntries(Object.entries(shown).map(([k, g]) => [k, mesh(g)])) };
const page = readFileSync(here + 'page.html', 'utf8').replace('/*DATA*/', () => 'const DATA = ' + JSON.stringify(data) + ';');
writeFileSync(here + 'meetrix-enclosure.html', page);
console.log('meetrix-enclosure.html', page.length, 'bytes');
if (fail.length) { console.log(fail.length + ' checks failed'); process.exit(1); }
