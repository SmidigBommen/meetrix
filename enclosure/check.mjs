// Mesh repair and mechanical checks.
import jscad from '@jscad/modeling';
import { P, dims } from './box.mjs';

// CSG leaves vertices lying on neighbours' edges, which shows as specks and leaks in STL.
// Weld vertices, split every edge at vertices that lie on it, then fan each polygon from its center.
export function repair(g) {
  const V = [], cells = new Map(), T = 1e-3, cell = v => v.map(c => Math.floor(c / 0.01));
  const weld = v => {
    const [a, b, c] = cell(v);
    for (let i = -1; i < 2; i++) for (let j = -1; j < 2; j++) for (let k = -1; k < 2; k++)
      for (const n of cells.get((a + i) + ',' + (b + j) + ',' + (c + k)) || []) if (Math.hypot(V[n][0] - v[0], V[n][1] - v[1], V[n][2] - v[2]) < T) return n;
    const key = a + ',' + b + ',' + c; V.push([...v]); cells.set(key, [...(cells.get(key) || []), V.length - 1]); return V.length - 1;
  };
  const polys = jscad.geometries.geom3.toPolygons(g).map(p => p.vertices.map(weld).filter((n, i, a) => n !== a[(i + 1) % a.length])).filter(p => p.length > 2);
  const cut = new Map();
  const between = (i, j) => {
    const key = i < j ? i + '_' + j : j + '_' + i;
    if (!cut.has(key)) {
      const a = V[Math.min(i, j)], b = V[Math.max(i, j)], d = b.map((c, k) => c - a[k]), L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, on = [];
      const lo = a.map((c, k) => Math.min(c, b[k]) - T), hi = a.map((c, k) => Math.max(c, b[k]) + T);
      for (let n = 0; n < V.length; n++) {
        const v = V[n];
        if (n === i || n === j || v[0] < lo[0] || v[0] > hi[0] || v[1] < lo[1] || v[1] > hi[1] || v[2] < lo[2] || v[2] > hi[2]) continue;
        const t = ((v[0] - a[0]) * d[0] + (v[1] - a[1]) * d[1] + (v[2] - a[2]) * d[2]) / L2;
        if (t > 0 && t < 1 && Math.hypot(a[0] + t * d[0] - v[0], a[1] + t * d[1] - v[1], a[2] + t * d[2] - v[2]) < 2 * T) on.push([t, n]);
      }
      cut.set(key, on.sort((p, q) => p[0] - q[0]).map(q => q[1]));
    }
    return i < j ? cut.get(key) : [...cut.get(key)].reverse();
  };
  const tris = [];
  for (const p of polys) {
    const loop = p.flatMap((n, i) => [n, ...between(n, p[(i + 1) % p.length])]);
    if (loop.length === 3) { tris.push(loop); continue; }
    const c = [0, 1, 2].map(k => p.reduce((t, n) => t + V[n][k], 0) / p.length), m = V.push(c) - 1;
    loop.forEach((n, i) => tris.push([m, n, loop[(i + 1) % loop.length]]));
  }
  const e = new Map();
  for (const t of tris) for (let i = 0; i < 3; i++) { const k = t[i] + '|' + t[(i + 1) % 3]; e.set(k, (e.get(k) || 0) + 1); }
  let leaks = 0;
  for (const [k, n] of e) { const [a, b] = k.split('|'); if ((e.get(b + '|' + a) || 0) !== n) leaks++; }
  return { tris: tris.map(t => t.map(n => V[n])), leaks };
}

export function stl(tris) {
  const b = Buffer.alloc(84 + tris.length * 50); b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const [a, c, d] = t, u = c.map((v, k) => v - a[k]), w = d.map((v, k) => v - a[k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
    [...n.map(v => v / l), ...a, ...c, ...d].forEach((v, k) => b.writeFloatLE(v, 84 + i * 50 + k * 4));
  });
  return b;
}

// Can a rigid key be pressed anywhere? Hooks stop it rising, the case stops it sinking. A press at a point
// clicks if a switch must give before any corner of the key touches the case. Small linear program, solved by corners.
function solve(r) {
  const m = r.map(x => [...x]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let j = i; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    if (Math.abs(m[p][i]) < 1e-9) return null;
    [m[i], m[p]] = [m[p], m[i]];
    for (let j = 0; j < 3; j++) if (j !== i) { const f = m[j][i] / m[i][i]; for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k]; }
  }
  return m.map((x, i) => x[3] / x[i]);
}
export function pressAnywhere(play) {
  const signs = [[1, 1], [1, -1], [-1, 1], [-1, -1]], hw = dims.keyW / 2, hd = P.D / 2;
  const base = [...signs.map(([a, b]) => [1, a * P.swX, b * P.swZ, P.padPlay + P.click]), ...signs.map(([a, b]) => [-1, -a * P.hookX, -b * P.hookZ, play])];
  const max = (stop, x, z) => {
    const c = [...base, ...signs.map(([a, b]) => [1, a * hw, b * hd, stop])]; let best = -Infinity;
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
      const s = solve([c[i], c[j], c[k]]);
      if (s && c.every(q => q[0] * s[0] + q[1] * s[1] + q[2] * s[2] <= q[3] + 1e-7)) best = Math.max(best, s[0] + s[1] * x + s[2] * z);
    }
    return best;
  };
  let ok = 0, n = 0, travel = 0;
  for (let i = 0; i <= 14; i++) for (let j = 0; j <= 10; j++) {
    const x = (i / 14 - 0.5) * 2 * hw, z = (j / 10 - 0.5) * 2 * hd, free = max(50, x, z);
    n++; travel = Math.max(travel, free); if (free - max(P.reveal, x, z) < 1e-6) ok++;
  }
  return { share: ok / n, travel };
}
