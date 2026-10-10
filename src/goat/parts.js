// Secondary goat parts sculpted as SDFs (teeth, tongue, ears, hooves, wattles)
// plus the skin-weight function shared by the head and body meshes.

import {
  smin, smax, smoothstep, clamp, mix, noise3,
  sdEllipsoid, sdRoundCone, sdSphere, sdBox, sdCapsule,
} from '../sdf.js';
import {
  BONES, boneWorldPositions, worldToHead, splitT, jawWeight, MOUTH_Y,
} from './anatomy.js';

// ------------------------------------------------------------------ teeth
// Lower arcade: 8 spatulate incisiform teeth (3 incisor pairs + incisiform
// canines) fanned in a procumbent arc, then a diastema, then 3 premolars and
// 3 molars per side with crescent (selenodont) enamel ridges.
// Upper arcade: NO incisors (dental pad) + 6 cheek teeth per side, set wider
// than the lower ones (anisognathism), which is why goats grind one side at
// a time with a big sideways sweep.
const LOWER_MOLAR_X = 0.0158;
const UPPER_MOLAR_X = 0.0192;
export const CHEEK_TOOTH_Z = [0.081, 0.093, 0.105, 0.118, 0.131, 0.145]; // M3..P2 (back to front)
const TOOTH_LEN = [0.0135, 0.0128, 0.0122, 0.0112, 0.0102, 0.0092];

function cheekTooth(x, y, z, cx, cy, cz, len, wid, h, upper) {
  let d = sdBox(x, y, z, cx, cy, cz, wid * 0.5, h * 0.5, len * 0.5, 0.0018);
  // occlusal surface: two crescents (selenodont) -> ridges across the crown
  const top = upper ? cy - h * 0.5 : cy + h * 0.5;
  const s = upper ? -1 : 1;
  const ridge = Math.cos(((z - cz) / len) * Math.PI * 2) * 0.5 + 0.5;
  const lat = Math.cos(((x - cx) / wid) * Math.PI * 1.6);
  d += 0.0007 * ridge * lat * smoothstep(0.003, 0, Math.abs(y - top)) * s * s;
  return d;
}

export function lowerTeethSDF(x, y, z) {
  const ax = Math.abs(x);
  let d = 1e9;
  // incisors: arc centred behind the chin
  if (z > 0.2) {
    for (let i = 0; i < 4; i++) {
      const a = (i + 0.5) * 0.3; // radians from midline
      const cx = Math.sin(a) * 0.019;
      const cz = 0.221 + Math.cos(a) * 0.0185;
      // procumbent crown: leans forward ~50 deg
      const dx = ax - cx, dz = z - cz;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lx = dx * ca - dz * sa; // across the tooth
      const lz = dx * sa + dz * ca; // labial/lingual
      const ly = y - (MOUTH_Y - 0.0068);
      // rotate in the sagittal plane (lean forward)
      const lean = 0.85;
      const cl = Math.cos(lean), sl = Math.sin(lean);
      const ry = ly * cl - lz * sl;
      const rz = ly * sl + lz * cl;
      const w = 0.0032 - i * 0.0003;
      let t = sdEllipsoid(lx, ry, rz, 0, 0.0045, 0, w, 0.0078, 0.0017);
      t = smin(t, sdRoundCone(lx, ry, rz, 0, -0.008, 0, 0, 0.002, 0, 0.0015, 0.0022), 0.002);
      d = Math.min(d, t);
    }
  }
  if (z < 0.16 && z > 0.07) {
    for (let i = 0; i < 6; i++) {
      d = Math.min(d, cheekTooth(ax, y, z, LOWER_MOLAR_X, MOUTH_Y - 0.0058, CHEEK_TOOTH_Z[i], TOOTH_LEN[i], 0.0075 - i * 0.0004, 0.0085, false));
    }
  }
  return d;
}

export function upperTeethSDF(x, y, z) {
  const ax = Math.abs(x);
  let d = 1e9;
  if (z < 0.16 && z > 0.07) {
    for (let i = 0; i < 6; i++) {
      d = Math.min(d, cheekTooth(ax, y, z, UPPER_MOLAR_X, MOUTH_Y + 0.0058, CHEEK_TOOTH_Z[i] + 0.002, TOOTH_LEN[i], 0.0085 - i * 0.0004, 0.0085, true));
    }
  }
  return d;
}

// ------------------------------------------------------------------ tongue
// Ruminant tongue: long, narrow, with the raised dorsal "torus linguae" at
// the back and a fossa in front of it. Coordinates: head-local.
export function tongueSDF(x, y, z) {
  const sy = 1 / 0.62;
  let d = sdRoundCone(x, (y + 0.043) * sy, z, 0, 0, 0.055, 0, 0.004, 0.226, 0.0122, 0.0075) / sy;
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.0385, 0.105, 0.0115, 0.0062, 0.034), 0.006); // torus
  d = smax(d, -sdEllipsoid(x, y, z, 0, -0.0345, 0.15, 0.006, 0.0025, 0.015), 0.004); // fossa
  d = smax(d, -sdEllipsoid(x, y, z, 0, -0.035, 0.2, 0.0012, 0.0016, 0.03), 0.002); // median groove
  if (d < 0.002) d += 0.00025 * noise3(x * 1600, y * 1600, z * 1600); // papillae
  return d;
}

// ------------------------------------------------------------------ ear
// Ear-local: +Y along the ear, +Z is the inner (concave) face.
export function earSDF(x, y, z) {
  const w = 0.026 * Math.pow(Math.sin(clamp(y / 0.125, 0, 1) * Math.PI * 0.92 + 0.12), 0.7);
  let d = sdEllipsoid(x, y, z, 0, 0.062, 0, 0.026, 0.064, 0.0075);
  d = smin(d, sdRoundCone(x, y, z, 0, -0.004, -0.002, 0, 0.03, 0, 0.011, 0.016), 0.01);
  // scoop out the inner face, leaving a rolled rim
  d = smax(d, -sdEllipsoid(x, y, z, 0, 0.066, 0.0085, 0.0205, 0.054, 0.0075), 0.002);
  d = smax(d, Math.abs(x) - w - 0.002, 0.004);
  return d;
}
export function earColor(x, y, z) {
  const inner = z > 0.0005 && Math.abs(x) < 0.02 ? smoothstep(0.0005, 0.003, z) : 0;
  const vein = 0.5 + 0.5 * Math.sin(x * 900 + noise3(x * 300, y * 300, 0) * 2);
  const base = [0.86, 0.83, 0.77];
  const pink = [0.85, 0.58, 0.55 + 0.03 * vein];
  return base.map((c, i) => mix(c, pink[i], inner * 0.85));
}

// ------------------------------------------------------------------ hoof
// Hoof-local: origin at the hoof bone, sole at y = -0.022, toe towards +Z.
export function hoofSDF(x, y, z) {
  const ax = Math.abs(x);
  let d = sdRoundCone(ax, y, z, 0.0105, -0.006, -0.004, 0.0085, -0.016, 0.03, 0.0125, 0.005);
  d = smin(d, sdEllipsoid(ax, y, z, 0.0105, -0.006, 0.006, 0.012, 0.016, 0.02), 0.006);
  d = smax(d, -(y + 0.022), 0.002); // flat sole
  d = smax(d, y - 0.013 + (z + 0.01) * 0.25, 0.004); // coronary band slope
  d = smax(d, -sdBox(x, y, z, 0, -0.01, 0.022, 0.0011, 0.03, 0.03), 0.0015); // the cleft
  // dewclaws
  d = Math.min(d, sdEllipsoid(ax, y, z, 0.012, 0.024, -0.02, 0.0045, 0.0055, 0.0065));
  return d;
}

// ------------------------------------------------------------------ wattle
// Wattle-local: origin at the attachment, hangs along -Y.
export function wattleSDF(x, y, z) {
  let d = sdRoundCone(x, y, z, 0, -0.004, 0, 0, -0.04, 0.004, 0.0055, 0.0085);
  return d;
}

// ------------------------------------------------------------ skin weights
const BW = boneWorldPositions();
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// [bone, toward, radius, cutoff (0 = none), side]
const SEGS = [
  ['pelvis', 'spine1', 0.15, 0, 0],
  ['spine1', 'spine2', 0.16, 0, 0],
  ['spine2', 'neck0', 0.15, 0, 0],
  ['neck0', 'neck1', 0.075, 0.07, 0],
  ['neck1', 'neck2', 0.06, 0.06, 0],
  ['neck2', 'head', 0.05, 0.05, 0],
  ['scapulaL', 'humerusL', 0.06, 0.05, 1],
  ['humerusL', 'radiusL', 0.045, 0.035, 1],
  ['radiusL', 'carpusL', 0.032, 0.03, 1],
  ['carpusL', 'fetlockFL', 0.02, 0.025, 1],
  ['fetlockFL', 'hoofFL', 0.018, 0.025, 1],
  ['scapulaR', 'humerusR', 0.06, 0.05, -1],
  ['humerusR', 'radiusR', 0.045, 0.035, -1],
  ['radiusR', 'carpusR', 0.032, 0.03, -1],
  ['carpusR', 'fetlockFR', 0.02, 0.025, -1],
  ['fetlockFR', 'hoofFR', 0.018, 0.025, -1],
  ['femurL', 'tibiaL', 0.075, 0.05, 1],
  ['tibiaL', 'hockL', 0.04, 0.035, 1],
  ['hockL', 'fetlockHL', 0.02, 0.025, 1],
  ['fetlockHL', 'hoofHL', 0.018, 0.025, 1],
  ['femurR', 'tibiaR', 0.075, 0.05, -1],
  ['tibiaR', 'hockR', 0.04, 0.035, -1],
  ['hockR', 'fetlockHR', 0.02, 0.025, -1],
  ['fetlockHR', 'hoofHR', 0.018, 0.025, -1],
  ['tail', 'tailTip', 0.018, 0.03, 0],
].map(([b, t, r, cut, side]) => ({ i: BONE_INDEX[b], a: BW[b], b: BW[t], r, cut, side }));

function segDist(x, y, z, a, b) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h);
}

export function skinWeights(x, y, z) {
  const ws = new Map();
  const add = (i, w) => w > 1e-5 && ws.set(i, (ws.get(i) || 0) + w);
  const t = splitT(x, y, z);
  const hzone = smoothstep(-0.045, 0.03, t);

  if (hzone < 1) {
    let tot = 0;
    const tmp = [];
    for (const s of SEGS) {
      const d = segDist(x, y, z, s.a, s.b) - s.r;
      let w = 1 / Math.pow(Math.max(d, 0.004), 4);
      if (s.cut) w *= smoothstep(s.cut, 0, d);
      if (s.side > 0) w *= smoothstep(-0.025, 0.02, x);
      if (s.side < 0) w *= smoothstep(0.025, -0.02, x);
      tmp.push([s.i, w]);
      tot += w;
    }
    for (const [i, w] of tmp) add(i, (w / tot) * (1 - hzone));
  }
  if (hzone > 0) {
    const [hx, hy, hz] = worldToHead(x, y, z);
    const jw = jawWeight(hx, hy, hz);
    const ul = smoothstep(0.212, 0.248, hz) * smoothstep(0.012, -0.014, hy) * (1 - jw);
    const ll = smoothstep(0.2, 0.236, hz) * smoothstep(-0.072, -0.046, hy) * jw;
    add(BONE_INDEX.head, (1 - jw - ul) * hzone);
    add(BONE_INDEX.upperLip, ul * hzone);
    add(BONE_INDEX.jaw, (jw - ll) * hzone);
    add(BONE_INDEX.lowerLip, ll * hzone);
  }
  return top4(ws);
}

function top4(ws) {
  const arr = [...ws.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = arr.reduce((a, e) => a + e[1], 0) || 1;
  while (arr.length < 4) arr.push([0, 0]);
  return arr.map(([i, w]) => [i, w / s]);
}

const TONGUE_SEGS = ['tongue0', 'tongue1', 'tongue2', 'tongue3'].map((n) => BONE_INDEX[n]);
export function tongueWeights(hx, hy, hz) {
  // tongue bones are spaced along z in head-local space
  const zs = [0.096, 0.14, 0.185, 0.225];
  const ws = new Map();
  let jawPart = smoothstep(0.1, 0.055, hz);
  for (let k = 0; k < 4; k++) {
    const d = Math.abs(hz - zs[k]);
    const w = Math.max(0, 1 - d / 0.05);
    if (w > 0) ws.set(TONGUE_SEGS[k], w * (1 - jawPart));
  }
  if (hz > zs[3]) ws.set(TONGUE_SEGS[3], 1);
  if (jawPart > 0) ws.set(BONE_INDEX.jaw, jawPart);
  return top4(ws);
}
