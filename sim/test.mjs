import assert from 'node:assert/strict';
import { createFirmware } from '../build/fw.mjs';
import { Sim, STATES, loadState, hhmm } from './sim.mjs';
const S = 1e9;
const start = (state = 3, tweak = () => {}) => { const s = new Sim(createFirmware); loadState(s, state); tweak(s); s.power(true); s.run(s.t + 3 * S); return s; };
const run = (s, sec) => s.run(s.t + sec * S);
const press = (s, k, hold = 0.12) => { s.key(k, true); run(s, hold); s.key(k, false); run(s, 0.1); };
const door = s => s.graph.list().filter(m => m.own).map(m => hhmm(m.s) + '-' + hhmm(m.e)).join(',');
// Photograph the panel: light reaching each LED over 20 ms.
const photo = s => {
  run(s, 0.01); s.acc.fill(0); const t0 = s.t; run(s, 0.02); const dt = s.t - t0; let out = [];
  for (let y = 0; y < 32; y++) { let l = ''; for (let x = 0; x < 32; x++) {
    const [r, g, b] = [0, 1, 2].map(c => s.acc[(y * 32 + x) * 3 + c] / dt * 16);
    const on = v => v > 0.02;
    l += !on(r) && !on(g) && !on(b) ? '.' : on(r) && on(g) && on(b) ? 'W' : on(r) ? (r < 0.15 ? 'r' : 'R') : on(g) && g > b ? (g < 0.15 ? 'g' : 'G') : 'B'; }
    out.push(l); }
  return out; };
const count = (p, c) => p.join('').split(c).length - 1;
let n = 0; const test = (name, f) => { f(); n++; console.log('ok  ' + name); };

test('boot: clock synced, day fetched, whiteboard states drawn through the pins', () => {
  for (let i = 0; i < 4; i++) {
    const p = photo(start(i));
    const red = count(p, 'R'), green = count(p, 'G');
    if (process.env.SHOW) console.log(i, p.join('\n'));
    if (i === 0) assert(red > 500 && green < 20);
    if (i === 1) assert(red < 10 && green > 60 && green < 160);
    if (i === 2) assert(red > 350 && green > 130);        // later free slice is filled
    if (i === 3) assert(red > 270 && green > 30 && green < 100);   // free now is an outline
  }
});
test('day list is parsed field by field (regression: newline counted as a number)', () => {
  const s = start(1); const p = photo(s), row = p[30];
  assert(/^\.+$/.test(p[0]) && /^\.+$/.test(p[29]) && /^\.+$/.test(p[31]));   // blank rows around circle and dots
  assert.equal(row.replace(/\./g, '').toUpperCase(), 'GRGGGGGGGGRRGGGG');
});
test('+15 books in Microsoft 365, stops at the next meeting, cancel takes back 15 minutes', () => {
  const s = start(3);
  press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:15');
  press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:30');
  press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:30');
  press(s, 1); run(s, 2); assert.equal(door(s), '10:00-10:15');
  press(s, 1); run(s, 2); assert.equal(door(s), '');
  press(s, 1); run(s, 2); assert.equal(s.graph.list().length, 3);
});
test('partial last piece is taken back, used time is not', () => {
  let s = start(3, s => s.setClock(605));
  press(s, 0); run(s, 2); press(s, 0); run(s, 2); assert.equal(door(s), '10:05-10:30');
  press(s, 1); run(s, 2); assert.equal(door(s), '10:05-10:20');
  s.setClock(612); press(s, 1); run(s, 2); assert.equal(door(s), '10:05-10:12');
});
test('60 minute limit', () => {
  const s = start(1); for (let i = 0; i < 6; i++) { press(s, 0); run(s, 1.5); }
  assert.equal(door(s), '10:00-11:00');
});
test('fast presses while a request is in flight are not lost', () => {
  const s = start(1, s => { s.latencyMs = 400; });
  press(s, 0, 0.06); press(s, 0, 0.06); press(s, 0, 0.06); press(s, 1, 0.06); run(s, 8);
  assert.equal(door(s), '10:00-10:30');
});
test('occupied room refuses both keys', () => {
  const s = start(0); press(s, 0); press(s, 1); run(s, 2);
  assert.equal(door(s), ''); assert.equal(s.graph.list().length, 5);
});
test('conflict made in Outlook between polls: bridge answers 409, panel follows the calendar', () => {
  const s = start(1); run(s, 2.6); s.graph.add(600, 630, 'Walk-in', false);
  press(s, 0); run(s, 3); assert.equal(door(s), '');
  assert(s.log.some(l => l.text.includes('409'))); assert(count(photo(s), 'R') > 250);
});
test('bounce: debounced key counts once, undebounced counts several times', () => {
  let s = start(1, s => { s.bounceMs = 15; }); press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:15');
  let worst = 0;
  for (let i = 0; i < 5; i++) { s = start(1, s => { s.bounceMs = 15; s.config.debounce = 1; }); press(s, 0); run(s, 3); worst = Math.max(worst, s.graph.list().filter(m => m.own).reduce((a, m) => a + m.e - m.s, 0)); }
  assert(worst > 15, 'expected extra presses');
});
test('missing pull-up gives ghost presses', () => {
  const s = start(1, s => { s.config.debounce = 1; s.config.pullup = 0; }); run(s, 2);
  assert(s.log.some(l => /book/.test(l.text)));
});
test('logic analyzer: one step is 32 clocks, one latch, then OE falls', () => {
  const s = start(0); s.wantCapture = true; run(s, 0.05);
  const edges = (bank, b) => { let n = 0; for (let i = 1; i < s.capture.n; i++) { const a = s[bank][i - 1] >>> b & 1, c = s[bank][i] >>> b & 1; if (!a && c) n++; } return n; };
  assert.equal(edges('cap0', 2), 32); assert(s.cap0[0] >>> 14 & 1); assert.equal(s.cap0[s.capture.n - 1] >>> 14 & 1, 0);
  assert(s.capT[s.capture.n - 1] < 4200);
});
test('wire faults: cut D repeats rows, cut OE is dark, cut R1 loses red on the top half only', () => {
  const s = start(0); s.cut.add('D'); s.applyWires(); let p = photo(s);
  assert.equal(count(p.slice(8, 16), 'R'), 0);
  s.cut = new Set(['OE']); s.applyWires(); assert.equal(count(photo(s), 'R'), 0);
  s.cut = new Set(['R1']); s.applyWires(); p = photo(s); assert.equal(count(p.slice(0, 16), 'R'), 0); assert(count(p.slice(16), 'R') > 200);
});
test('Wi-Fi loss: keys refused, last day kept, blue mark, recovery', () => {
  const s = start(3); s.setWifi(false); run(s, 1); const p = photo(s); assert(count(p, 'B') >= 2 && count(p, 'R') > 270);
  press(s, 0); run(s, 1); assert.equal(door(s), '');
  s.setWifi(true); run(s, 6); press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:15');
});
test('Microsoft 365 outage during a booking rolls the panel back', () => {
  const s = start(1); s.graph.up = false; press(s, 0); run(s, 2); assert.equal(door(s), ''); run(s, 1);
  assert(count(photo(s), 'R') < 10); s.graph.up = true; run(s, 6); press(s, 0); run(s, 2); assert.equal(door(s), '10:00-10:15');
});
test('weak supply browns out and resets', () => {
  const s = start(0, s => { s.limitA = 0.5; s.config.bright = 100; }); run(s, 4); assert(s.resets > 0);
});
console.log('\nCurrent per state, 5 V side, simulated:');
for (const b of [100, 60, 25]) console.log('brightness ' + b + '%: ' + STATES.map((st, i) => { const s = start(i, s => { s.config.bright = b; s.limitA = 4; }); run(s, 0.5); return st.name + ' ' + s.amps.toFixed(2) + ' A'; }).join(', '));
{ const s = start(0); const f = s.frames, w = process.hrtime.bigint(); run(s, 1); console.log('refresh ' + (s.frames - f) + ' Hz; 1 s simulated in ' + (Number(process.hrtime.bigint() - w) / 1e9).toFixed(2) + ' s'); }
console.log(n + ' tests passed');
