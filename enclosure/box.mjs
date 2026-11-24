// Parametric enclosure. All sizes in mm. x = width, y = height, z = depth (front face at z = 0).
// Change the numbers in P, run `npm run enclosure`, and the STL files and the viewer follow.
import jscad from '@jscad/modeling';
const { cuboid, roundedCuboid, cylinder, polygon } = jscad.primitives;
const { union, subtract, intersect } = jscad.booleans;
const { extrudeLinear } = jscad.extrusions;
const { translate, rotateX, rotateY } = jscad.transforms;

export const P = {
  panel: 128,        // 32 x 32 LEDs at 4 mm pitch (assumed; measure yours)
  panelDepth: 15,    // panel thickness without the plugged-in board (assumed)
  fit: 0.4,          // clearance per side
  W: 150, H: 150, D: 45,
  wall: 3, front: 2, plate: 2.4, radius: 2.5,
  window: 126,       // front opening; the lip holds the diffuser and the panel
  diffuser: 2,       // smoked acrylic sheet, panel x panel
  // Two keys that together cover the whole top
  keyH: 9, seam: 1, reveal: 1.2,          // key height, gap between the keys, gap down to the case
  keyWall: 2, keyTop: 2.4,
  swX: 17, swZ: 9,                        // four switches per key, offset from the key's center
  hookX: 21, hookZ: 15.5, hookPlay: 0.2,  // four snap hooks per key
  barb: 0.9, leg: 1.6, legW: 6, slotGap: 0.3, flex: 0.8,
  rimGap: 0.5, rimT: 1.6, rimUp: 1.5,    // rim inside each key, blocks the view through the gap
  padPlay: 0.1, click: 0.3,               // air above the plunger, plunger travel (assumed, check your switch)
  mark: 18, markStroke: 2.4, markDepth: 1,
  switchH: 5,        // 6 x 6 x 5 mm tactile switch
};
const S = 48;
const inner = P.W - 2 * P.wall;                      // 144
const pocket = P.panel + 2 * P.fit;                  // 128.8
const post = (inner - pocket) / 2;                   // corner blocks locate the panel
const stackZ = P.front + P.diffuser + P.panelDepth;  // back of the panel
const plateZ = P.D - P.plate;
const caseTop = P.H / 2;
const keyBottom = caseTop + P.reveal, keyTopY = keyBottom + P.keyH, under = keyTopY - P.keyTop;
const keyW = (P.W - P.seam) / 2, keyCx = (P.seam + keyW) / 2, keyCz = P.D / 2;
const four = (dx, dz) => corners.map(([a, c]) => [a * dx, c * dz]);
const postXY = inner / 2 - post / 2;
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const cylY = o => rotateX(-Math.PI / 2, cylinder({ segments: S, ...o }));   // axis along y
const keyholes = [[-40, 35], [40, 35]];

export function shell() {
  let s = roundedCuboid({ size: [P.W, P.H + 10, P.D], center: [0, 5, P.D / 2], roundRadius: P.radius, segments: 32 });
  s = subtract(s, cuboid({ size: [P.W + 2, 20, P.D + 2], center: [0, caseTop + 10, P.D / 2] }));   // flat top under the keys
  s = subtract(s, cuboid({ size: [inner, inner, P.D], center: [0, 0, P.front + P.D / 2] }));
  s = subtract(s, cuboid({ size: [P.window, P.window, 10], center: [0, 0, 0] }));
  for (const [sx, sy] of corners) {
    const block = cuboid({ size: [post + 1, post + 1, plateZ - P.front], center: [sx * (postXY + 0.5), sy * (postXY + 0.5), (P.front + plateZ) / 2] });
    const insert = cylinder({ radius: 2, height: 8, center: [sx * postXY, sy * postXY, plateZ - 4 + 0.01], segments: 24 });   // M3 heat-set insert
    s = subtract(union(s, block), insert);
  }
  for (const sx of [-1, 1]) {
    const o = P.keyWall + P.rimGap, i = o + P.rimT, h = P.reveal + P.rimUp;
    s = union(s, subtract(
      cuboid({ size: [keyW - 2 * o, h + 1, P.D - 2 * o], center: [sx * keyCx, caseTop + (h - 1) / 2, keyCz] }),
      cuboid({ size: [keyW - 2 * i, h + 4, P.D - 2 * i], center: [sx * keyCx, caseTop + h / 2, keyCz] })));
    for (const [x, z] of four(P.hookX, P.hookZ)) {
      const d = Math.sign(z), zi = keyCz + z - d * (P.leg / 2 + P.flex), zo = keyCz + z + d * (P.leg / 2 + P.slotGap);
      s = subtract(s, cuboid({ size: [P.legW + 0.6, P.wall + 2, Math.abs(zo - zi)], center: [sx * keyCx + x, caseTop - P.wall / 2, (zi + zo) / 2] }));
    }
    // Holes for the switch legs; the switches sit on top of the case, hidden by the keys
    for (const [x, z] of four(P.swX, P.swZ)) for (const [lx, lz] of four(3.25, 2.25))
      s = subtract(s, translate([sx * keyCx + x + lx, caseTop - P.wall / 2, keyCz + z + lz], cylY({ radius: 0.7, height: P.wall + 2, segments: 12 })));
  }
  // Cable exit, bottom edge at the back
  return subtract(s, cuboid({ size: [14, P.wall + 2, 8], center: [0, -P.H / 2 + P.wall / 2, plateZ - 4 + 0.01] }));
}

export function backPlate() {
  const side = inner - 2 * P.fit;
  let b = cuboid({ size: [side, side, P.plate], center: [0, 0, plateZ + P.plate / 2] });
  // Four pillars press the panel against the diffuser, whatever its mounting holes are
  for (const [sx, sy] of corners) b = union(b, cylinder({ radius: 3.5, height: plateZ - stackZ, center: [sx * 50, sy * 50, (plateZ + stackZ) / 2], segments: 32 }));
  const hole = (x, y, r) => cylinder({ radius: r, height: P.plate + 2, center: [x, y, plateZ + P.plate / 2], segments: 24 });
  for (const [sx, sy] of corners) b = subtract(b, hole(sx * postXY, sy * postXY, 1.7));
  // Vent: round holes on a grid inside a circle
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (i * i + j * j <= 10) b = subtract(b, hole(i * 8, j * 8, 1.5));
  // Keyhole slots for two wall screws
  for (const [x, y] of keyholes) b = subtract(b, hole(x, y, 4), hole(x, y + 8, 2), cuboid({ size: [4, 8, P.plate + 2], center: [x, y + 4, plateZ + P.plate / 2] }));
  return b;
}

// Keys, modeled in place. side = 1 is the left key seen from the front.
const markBars = plus => [[P.mark, P.markStroke], ...(plus ? [[P.markStroke, P.mark]] : [])];
export function key(side, plus) {
  const tall = P.keyH + 10, r = P.radius;
  let k = roundedCuboid({ size: [P.W, tall, P.D], center: [0, keyTopY - tall / 2, P.D / 2], roundRadius: r, segments: 32 });
  const x0 = side > 0 ? P.seam / 2 : -P.W, w = P.W - P.seam / 2;
  k = intersect(k, cuboid({ size: [w, P.keyH + 2, P.D + 2], center: [x0 + w / 2, keyBottom + P.keyH / 2 + 1, P.D / 2] }));
  k = subtract(k, cuboid({ size: [keyW - 2 * P.keyWall, P.keyH - P.keyTop + 2, P.D - 2 * P.keyWall], center: [side * keyCx, under - (P.keyH - P.keyTop + 2) / 2, keyCz] }));
  for (const [x, z] of four(P.swX, P.swZ)) {
    const bottom = caseTop + P.switchH + P.padPlay;
    k = union(k, translate([side * keyCx + x, (under + 0.5 + bottom) / 2, keyCz + z], cylY({ radius: 3, height: under + 0.5 - bottom, segments: 24 })));
  }
  const ledge = caseTop - P.wall - P.hookPlay, tip = ledge - 2.4;
  for (const [x, z] of four(P.hookX, P.hookZ)) {
    const d = Math.sign(z), zi = keyCz + z - d * P.leg / 2, zo = keyCz + z + d * P.leg / 2;
    // Profile in (-z, y), extruded along x
    let pts = [[zi, under + 0.5], [zo, under + 0.5], [zo, ledge], [zo + d * P.barb, ledge], [zo, tip], [zi, tip]].map(([a, y]) => [-a, y]);
    const area = pts.reduce((t, q, i) => { const n = pts[(i + 1) % pts.length]; return t + q[0] * n[1] - n[0] * q[1]; }, 0);
    if (area < 0) pts = pts.reverse();
    k = union(k, translate([side * keyCx + x - P.legW / 2, 0, 0], rotateY(Math.PI / 2, extrudeLinear({ height: P.legW }, polygon({ points: pts })))));
  }
  for (const [a, b] of markBars(plus)) k = subtract(k, cuboid({ size: [a, P.markDepth * 2, b], center: [side * keyCx, keyTopY, keyCz] }));
  return k;
}
// Paint in the engraved marks, for the viewer only
export const paint = (side, plus) => union(...markBars(plus).map(([a, b]) => cuboid({ size: [a - 0.02, 0.4, b - 0.02], center: [side * keyCx, keyTopY - P.markDepth + 0.2, keyCz] })));
export const forPrint = {
  backPlate: g => translate([0, 0, P.D], rotateY(Math.PI, g)),
  key: g => translate([0, 0, keyTopY], rotateX(-Math.PI / 2, g)),   // top face down
};

// Bought parts, for the viewer and the fit checks
export const bought = {
  diffuser: () => cuboid({ size: [P.panel, P.panel, P.diffuser], center: [0, 0, P.front + P.diffuser / 2] }),
  panel: () => cuboid({ size: [P.panel, P.panel, P.panelDepth], center: [0, 0, stackZ - P.panelDepth / 2] }),
  board: () => cuboid({ size: [58, 41, 12], center: [-30, 0, stackZ + 6] }),          // rough outline only
  switches: () => union(...[-1, 1].flatMap(sx => four(P.swX, P.swZ).map(([x, z]) => union(
    cuboid({ size: [6, 3.5, 6], center: [sx * keyCx + x, caseTop + 1.75, keyCz + z] }),
    translate([sx * keyCx + x, caseTop + 3.5 + (P.switchH - 3.5) / 2, keyCz + z], cylY({ radius: 1.75, height: P.switchH - 3.5, segments: 16 })))))),
};
export const dims = { inner, pocket, post, stackZ, plateZ, caseTop, keyTopY, keyW, keyCx, keyCz };
