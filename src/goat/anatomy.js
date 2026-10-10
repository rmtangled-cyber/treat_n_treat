// Goat anatomy: skeleton landmarks and the sculpted signed distance field.
//
// Reference build: adult Saanen-type dairy doe (the classic white goat kept on
// Japanese farms). Withers ≈ 0.80 m, body length ≈ 0.80 m, heart girth ≈ 0.9 m
// (NSW DPI breed profile; Rev Mex Cienc Pecu 2023 Saanen morphometrics).
// Coordinates: metres, +Y up, the goat faces +Z, +X is the goat's LEFT side.
//
// Anatomical features modelled (things you can look for while she eats):
//  - no upper incisors: a firm dental pad opposes 8 lower incisiform teeth
//  - split (cleft) upper lip with a philtrum groove — the mobile, prehensile lip
//  - comma-shaped nostrils on a small moist muzzle
//  - narrow lower jaw vs wide upper jaw (anisognathism) -> one-sided grinding
//  - ridged hard palate (rugae) and the dorsal torus of the tongue
//  - horizontal rectangular pupils, beard, wattles, backward-curving horns
//  - rumen bulge on the left flank, esophagus in the left jugular groove

import {
  smin, smax, smoothstep, clamp, mix,
  sdEllipsoid, sdRoundCone, sdSphere, noise3,
  makeOrientedEllipsoid, rotX, rotZ, rotY, mulM,
} from '../sdf.js';

export const HEAD_PITCH = (42 * Math.PI) / 180; // face line below horizontal at rest
const NECK1 = [0, 0.82, 0.41];
const NECK2 = [0, 0.915, 0.485];
const HEAD_P = [0, 1.0, 0.552];
const cosP = Math.cos(HEAD_PITCH), sinP = Math.sin(HEAD_PITCH);

// Skeleton in the bind pose (world positions). parent: null for root.
// `head` bone frame is pitched down by HEAD_PITCH; its children are defined
// in head-local coordinates (see `local: true`).
export const BONES = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 'root', pos: [0, 0.74, -0.24] },
  { name: 'spine1', parent: 'pelvis', pos: [0, 0.76, -0.04] },
  { name: 'spine2', parent: 'spine1', pos: [0, 0.78, 0.16] },
  { name: 'neck0', parent: 'spine2', pos: [0, 0.73, 0.32] },
  { name: 'neck1', parent: 'neck0', pos: NECK1 },
  { name: 'neck2', parent: 'neck1', pos: NECK2 },
  { name: 'head', parent: 'neck2', pos: HEAD_P },
  // head-local children
  { name: 'jaw', parent: 'head', local: [0, -0.004, 0.046] },
  { name: 'upperLip', parent: 'head', local: [0, -0.012, 0.226] },
  { name: 'lowerLip', parent: 'jaw', local: [0, -0.04, 0.18] }, // relative to jaw (head frame axes)
  { name: 'tongue0', parent: 'jaw', local: [0, -0.04, 0.05] },
  { name: 'tongue1', parent: 'tongue0', local: [0, 0.005, 0.044] },
  { name: 'tongue2', parent: 'tongue1', local: [0, 0.0, 0.045] },
  { name: 'tongue3', parent: 'tongue2', local: [0, 0.0, 0.04] },
  { name: 'earL', parent: 'head', local: [0.046, 0.062, 0.02] },
  { name: 'earR', parent: 'head', local: [-0.046, 0.062, 0.02] },
  { name: 'eyeL', parent: 'head', local: [0.0565, 0.027, 0.1] },
  { name: 'eyeR', parent: 'head', local: [-0.0565, 0.027, 0.1] },
  // forelegs
  { name: 'scapulaL', parent: 'spine2', pos: [0.1, 0.7, 0.21] },
  { name: 'humerusL', parent: 'scapulaL', pos: [0.1, 0.55, 0.33] },
  { name: 'radiusL', parent: 'humerusL', pos: [0.088, 0.43, 0.245] },
  { name: 'carpusL', parent: 'radiusL', pos: [0.08, 0.235, 0.265] },
  { name: 'fetlockFL', parent: 'carpusL', pos: [0.078, 0.075, 0.272] },
  { name: 'hoofFL', parent: 'fetlockFL', pos: [0.078, 0.022, 0.296] },
  { name: 'scapulaR', parent: 'spine2', pos: [-0.1, 0.7, 0.21] },
  { name: 'humerusR', parent: 'scapulaR', pos: [-0.1, 0.55, 0.33] },
  { name: 'radiusR', parent: 'humerusR', pos: [-0.088, 0.43, 0.245] },
  { name: 'carpusR', parent: 'radiusR', pos: [-0.08, 0.235, 0.265] },
  { name: 'fetlockFR', parent: 'carpusR', pos: [-0.078, 0.075, 0.272] },
  { name: 'hoofFR', parent: 'fetlockFR', pos: [-0.078, 0.022, 0.296] },
  // hind legs
  { name: 'femurL', parent: 'pelvis', pos: [0.08, 0.72, -0.28] },
  { name: 'tibiaL', parent: 'femurL', pos: [0.1, 0.5, -0.17] },
  { name: 'hockL', parent: 'tibiaL', pos: [0.085, 0.3, -0.37] },
  { name: 'fetlockHL', parent: 'hockL', pos: [0.08, 0.075, -0.335] },
  { name: 'hoofHL', parent: 'fetlockHL', pos: [0.08, 0.022, -0.31] },
  { name: 'femurR', parent: 'pelvis', pos: [-0.08, 0.72, -0.28] },
  { name: 'tibiaR', parent: 'femurR', pos: [-0.1, 0.5, -0.17] },
  { name: 'hockR', parent: 'tibiaR', pos: [-0.085, 0.3, -0.37] },
  { name: 'fetlockHR', parent: 'hockR', pos: [-0.08, 0.075, -0.335] },
  { name: 'hoofHR', parent: 'fetlockHR', pos: [-0.08, 0.022, -0.31] },
  // tail
  { name: 'tail', parent: 'pelvis', pos: [0, 0.72, -0.42] },
  { name: 'tailTip', parent: 'tail', pos: [0, 0.785, -0.5] },
];

export const HEAD_POS = HEAD_P;
// head frame axes in world
export const HEAD_Y = [0, cosP, sinP];
export const HEAD_Z = [0, -sinP, cosP];

export function headToWorld(l) {
  return [
    HEAD_POS[0] + l[0],
    HEAD_POS[1] + l[1] * HEAD_Y[1] + l[2] * HEAD_Z[1],
    HEAD_POS[2] + l[1] * HEAD_Y[2] + l[2] * HEAD_Z[2],
  ];
}

// Resolve world bind positions for every bone.
export function boneWorldPositions() {
  const out = {};
  const byName = Object.fromEntries(BONES.map((b) => [b.name, b]));
  const resolve = (name) => {
    if (out[name]) return out[name];
    const b = byName[name];
    if (b.pos) return (out[name] = b.pos);
    // local in head frame, accumulate relative to parent
    const parentPos = resolve(b.parent);
    const p = [
      parentPos[0] + b.local[0],
      parentPos[1] + b.local[1] * HEAD_Y[1] + b.local[2] * HEAD_Z[1],
      parentPos[2] + b.local[1] * HEAD_Y[2] + b.local[2] * HEAD_Z[2],
    ];
    return (out[name] = p);
  };
  for (const b of BONES) resolve(b.name);
  return out;
}
// Bones whose bind orientation follows the head pitch.
export function isHeadFrameBone(name) {
  let b = BONES.find((x) => x.name === name);
  while (b) {
    if (b.name === 'head') return true;
    b = BONES.find((x) => x.name === b.parent);
  }
  return false;
}

// ---------------------------------------------------------------- head SDF
// (head-local coordinates: origin at the atlanto-occipital joint, +Z along
//  the nasal line, +Y dorsal)

const NOSTRIL_M = mulM(rotZ(-0.55), rotY(0.35));
const nostrilL = makeOrientedEllipsoid([0.0148, 0.0105, 0.262], [0.0021, 0.0085, 0.0065], NOSTRIL_M);
const NOSTRIL_MR = mulM(rotZ(0.55), rotY(-0.35));
const nostrilR = makeOrientedEllipsoid([-0.0148, 0.0105, 0.262], [0.0021, 0.0085, 0.0065], NOSTRIL_MR);

export const EYE_C = [0.0565, 0.027, 0.1];
export const EYE_R = 0.0145;
export const MOUTH_Y = -0.033; // slit height at the lips (head local)
// The head is sculpted with the jaw dropped by this angle so the mesher can
// resolve the gap between the lips; the runtime "closed" pose rotates it shut.
export const JAW_BIND_OPEN = 0.032;
const TMJ_Z = 0.046;
export function slitCenterY(z) {
  return MOUTH_Y - Math.max(0, z - TMJ_Z) * JAW_BIND_OPEN * 0.5;
}
export const COMMISSURE_Z = 0.205;

export function cavitySDF(x, y, z) {
  // Mouth slit + oral cavity, carved out of the head.
  // wedge-shaped gap between the lips, closing at the commissure
  const half = Math.max(0, z - TMJ_Z) * JAW_BIND_OPEN * 0.5 * smoothstep(COMMISSURE_Z - 0.004, COMMISSURE_Z + 0.012, z);
  const slit = Math.max(Math.abs(y - slitCenterY(z)) - half, COMMISSURE_Z - 0.002 - z);
  let cav = sdEllipsoid(x, y, z, 0, MOUTH_Y - 0.001, 0.16, 0.0175, 0.0115, 0.085);
  // palatine rugae: transverse ridges on the roof of the mouth
  if (y > MOUTH_Y && z > 0.11 && z < 0.212) {
    const r = Math.sin((z - 0.11) * ((2 * Math.PI) / 0.0085));
    cav += 0.0009 * Math.max(0, r) * smoothstep(MOUTH_Y, MOUTH_Y + 0.006, y);
  }
  return Math.min(slit, cav);
}

// eye frame (left eye; mirrored for the right): gaze looks out and forward
const EG = (() => { const v = [0.8, 0.12, 0.58]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
const EX = (() => { // horizontal axis across the eye, perpendicular to the gaze
  const up = [0, 1, 0];
  const x = [up[1] * EG[2] - up[2] * EG[1], up[2] * EG[0] - up[0] * EG[2], up[0] * EG[1] - up[1] * EG[0]];
  const l = Math.hypot(...x); return x.map((c) => c / l);
})();
const EY = [EG[1] * EX[2] - EG[2] * EX[1], EG[2] * EX[0] - EG[0] * EX[2], EG[0] * EX[1] - EG[1] * EX[0]];
export const EYE_GAZE = EG;
function lidRing(x, y, z) {
  const dx = x - EYE_C[0], dy = y - EYE_C[1], dz = z - EYE_C[2];
  const lx = dx * EX[0] + dy * EX[1] + dz * EX[2];
  const ly = dx * EY[0] + dy * EY[1] + dz * EY[2];
  const lz = dx * EG[0] + dy * EG[1] + dz * EG[2] - 0.0068;
  // almond: wider than tall, slightly tilted
  const ex = lx / 1.0, ey = (ly + lx * 0.12) / 0.78;
  const rho = Math.hypot(ex, ey);
  const q = rho - 0.0118;
  return Math.hypot(q, lz) - 0.0026;
}

export function headSDF(x, y, z) {
  const ax = Math.abs(x);
  let d = sdEllipsoid(x, y, z, 0, 0.03, 0.045, 0.05, 0.05, 0.066); // cranium
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.042, 0.004, 0.04, 0.036, 0.034), 0.02); // poll/occiput
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.045, 0.095, 0.05, 0.033, 0.05), 0.02); // frontal
  d = smin(d, sdEllipsoid(ax, y, z, 0.043, 0.028, 0.099, 0.021, 0.023, 0.025), 0.016); // orbital rim
  d = smin(d, sdRoundCone(x, y, z, 0, 0.04, 0.115, 0, 0.02, 0.222, 0.037, 0.024), 0.02); // nasal bridge
  d = smin(d, sdRoundCone(ax, y, z, 0.03, -0.002, 0.105, 0.02, -0.008, 0.212, 0.03, 0.021), 0.02); // maxilla
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.0, 0.234, 0.03, 0.03, 0.034), 0.016); // muzzle
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.021, 0.243, 0.027, 0.0135, 0.028), 0.01); // upper lip
  d = smin(d, sdEllipsoid(ax, y, z, 0.012, -0.023, 0.252, 0.0155, 0.0115, 0.019), 0.006); // upper lip lobes
  d = smin(d, sdRoundCone(ax, y, z, 0.041, -0.002, 0.045, 0.036, -0.054, 0.052, 0.014, 0.018), 0.015); // ramus
  d = smin(d, sdRoundCone(ax, y, z, 0.035, -0.058, 0.058, 0.016, -0.05, 0.208, 0.017, 0.011), 0.016); // mandible body
  d = smin(d, sdEllipsoid(ax, y, z, 0.039, -0.032, 0.088, 0.018, 0.031, 0.042), 0.016); // masseter
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.047, 0.228, 0.02, 0.016, 0.022), 0.012); // chin / lower lip
  d = smin(d, sdRoundCone(ax, y, z, 0.022, -0.042, 0.13, 0.013, -0.041, 0.236, 0.012, 0.0105), 0.01); // lower lip sides
  d = smin(d, sdRoundCone(ax, y, z, 0.024, -0.024, 0.15, 0.016, -0.024, 0.24, 0.011, 0.0115), 0.01); // upper lip sides
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.052, 0.115, 0.026, 0.017, 0.08), 0.02); // intermandibular
  // subtle skin irregularity
  if (d < 0.004) d += 0.00022 * noise3(x * 120, y * 120, z * 120);
  // carve nostrils + philtrum (cleft upper lip)
  d = smax(d, -Math.min(nostrilL(x, y, z), nostrilR(x, y, z)), 0.003);
  d = smax(d, -sdEllipsoid(x, y, z, 0, -0.025, 0.27, 0.0017, 0.0155, 0.0065), 0.002);
  return d;
}

// ---------------------------------------------------------------- body SDF
const SCAP_L = makeOrientedEllipsoid([0.1, 0.655, 0.24], [0.026, 0.11, 0.065], rotX(0.35));
const THIGH_M = mulM(rotX(-0.25), rotZ(0.08));
const THIGH_L = makeOrientedEllipsoid([0.083, 0.585, -0.29], [0.052, 0.14, 0.085], THIGH_M);

function neckSDF(x, y, z) {
  // laterally compressed neck: scale X
  const sx = x / 0.8;
  let d = sdRoundCone(sx, y, z, 0, 0.64, 0.3, NECK1[0], NECK1[1], NECK1[2], 0.112, 0.07);
  d = smin(d, sdRoundCone(sx, y, z, ...NECK1, ...NECK2, 0.07, 0.054), 0.03);
  d = smin(d, sdRoundCone(sx, y, z, ...NECK2, HEAD_P[0], HEAD_P[1] - 0.008, HEAD_P[2] - 0.004, 0.054, 0.043), 0.03);
  // throat / trachea ridge on the ventral side
  d = smin(d, sdRoundCone(sx, y, z, 0, 0.66, 0.39, 0, NECK2[1] - 0.02, NECK2[2] + 0.04, 0.042, 0.028), 0.04);
  return d * 0.85;
}

function legSDF(x, y, z) {
  // x already mirrored to positive by caller (legs are symmetric)
  if (z < 0.08) return hindLegSDF(x, y, z);
  // foreleg
  let d = sdRoundCone(x, y, z, 0.093, 0.535, 0.305, 0.088, 0.44, 0.245, 0.042, 0.038); // upper arm
  d = smin(d, sdRoundCone(x, y, z, 0.088, 0.44, 0.245, 0.081, 0.25, 0.262, 0.04, 0.022), 0.03); // forearm
  d = smin(d, sdEllipsoid(x, y, z, 0.08, 0.232, 0.268, 0.022, 0.03, 0.024), 0.012); // carpus (knee)
  d = smin(d, sdRoundCone(x, y, z, 0.08, 0.22, 0.268, 0.078, 0.085, 0.272, 0.0175, 0.0155), 0.012); // cannon
  d = smin(d, sdEllipsoid(x, y, z, 0.078, 0.072, 0.276, 0.018, 0.02, 0.02), 0.01); // fetlock
  d = smin(d, sdRoundCone(x, y, z, 0.078, 0.07, 0.278, 0.078, 0.03, 0.296, 0.016, 0.017), 0.01); // pastern
  return d;
}
function hindLegSDF(x, y, z) {
  let h = THIGH_L(x, y, z);
  h = smin(h, sdRoundCone(x, y, z, 0.1, 0.5, -0.18, 0.086, 0.31, -0.365, 0.05, 0.026), 0.04); // gaskin
  h = smin(h, sdSphere(x, y, z, 0.086, 0.315, -0.385, 0.019), 0.015); // point of hock
  h = smin(h, sdRoundCone(x, y, z, 0.085, 0.3, -0.37, 0.08, 0.085, -0.336, 0.02, 0.016), 0.015); // cannon
  h = smin(h, sdEllipsoid(x, y, z, 0.08, 0.072, -0.332, 0.018, 0.02, 0.02), 0.01); // fetlock
  h = smin(h, sdRoundCone(x, y, z, 0.08, 0.07, -0.33, 0.08, 0.03, -0.312, 0.016, 0.017), 0.01); // pastern
  return h;
}

// distance from point to an axis-aligned box (0 inside) — cheap culling bound
function boxD(x, y, z, x0, y0, z0, x1, y1, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), dz = Math.max(z0 - z, 0, z - z1);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function bodySDF(x, y, z) {
  const ax = Math.abs(x);
  // barrel: chest, rumen-heavy mid body (bulges to the LEFT), hind quarters
  let d = sdEllipsoid(x, y, z, 0, 0.6, 0.19, 0.135, 0.185, 0.17);
  d = smin(d, sdEllipsoid(x, y, z, 0.012, 0.6, -0.03, 0.163, 0.2, 0.2), 0.08);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.635, -0.27, 0.125, 0.125, 0.16), 0.08);
  if (y > 0.6) {
    // top line: withers -> loin -> croup -> tail head
    d = smin(d, sdRoundCone(x, y, z, 0, 0.77, 0.21, 0, 0.745, -0.06, 0.045, 0.05), 0.06);
    d = smin(d, sdRoundCone(x, y, z, 0, 0.745, -0.06, 0, 0.74, -0.3, 0.05, 0.05), 0.05);
    d = smin(d, sdRoundCone(x, y, z, 0, 0.74, -0.3, 0, 0.705, -0.42, 0.05, 0.035), 0.04);
  }
  if (z < -0.12 && y > 0.6) {
    // angular dairy frame: hooks and pins
    d = smin(d, sdSphere(ax, y, z, 0.083, 0.735, -0.235, 0.034), 0.035);
    d = smin(d, sdSphere(ax, y, z, 0.048, 0.69, -0.42, 0.028), 0.03);
  }
  if (z > 0.05) {
    // shoulders + brisket
    if (boxD(ax, y, z, 0.07, 0.53, 0.17, 0.14, 0.78, 0.32) < d + 0.07) d = smin(d, SCAP_L(ax, y, z), 0.07);
    if (y < 0.6) d = smin(d, sdEllipsoid(x, y, z, 0, 0.47, 0.3, 0.075, 0.065, 0.08), 0.06);
  }
  // neck
  if (boxD(ax, y, z, 0, 0.53, 0.18, 0.13, 1.1, 0.66) < d + 0.05) d = smin(d, neckSDF(x, y, z), 0.05);
  // legs
  if (y < 0.66 && ax > 0.0) {
    if (boxD(ax, y, z, 0.03, -0.01, -0.44, 0.17, 0.66, 0.4) < d + 0.05) d = smin(d, legSDF(ax, y, z), z > 0.08 && y > 0.4 ? 0.05 : 0.035);
  }
  if (y < 0.56 && z < -0.12) {
    // udder + teats
    d = smin(d, sdEllipsoid(x, y, z, 0, 0.44, -0.245, 0.068, 0.07, 0.078), 0.04);
    d = smin(d, sdRoundCone(ax, y, z, 0.03, 0.39, -0.21, 0.036, 0.33, -0.198, 0.011, 0.008), 0.012);
  }
  // tail
  if (z < -0.36 && y > 0.62) d = smin(d, sdRoundCone(x, y, z, 0, 0.715, -0.415, 0, 0.785, -0.5, 0.02, 0.011), 0.02);
  // rib relief on the flank, very subtle
  if (y > 0.5 && y < 0.72 && z > -0.1 && z < 0.24) {
    d += 0.0012 * Math.sin(z * 62) * smoothstep(0.5, 0.6, y) * smoothstep(0.72, 0.64, y);
  }
  if (d < 0.02) d += 0.0006 * noise3(x * 30, y * 30, z * 30);
  return d;
}

export function worldToHead(x, y, z) {
  const dx = x - HEAD_POS[0], dy = y - HEAD_POS[1], dz = z - HEAD_POS[2];
  return [dx, dy * HEAD_Y[1] + dz * HEAD_Y[2], dy * HEAD_Z[1] + dz * HEAD_Z[2]];
}

// Full goat (excluding separate meshes: eyes, ears, horns, teeth, tongue, hooves...)
export function goatSDF(x, y, z) {
  const b = bodySDF(x, y, z);
  const dx = x - HEAD_POS[0], dy = y - HEAD_POS[1], dz = z - HEAD_POS[2];
  const ly = dy * HEAD_Y[1] + dz * HEAD_Y[2];
  const lz = dy * HEAD_Z[1] + dz * HEAD_Z[2];
  if (b > 0.12 && (Math.abs(dx) > 0.2 || ly > 0.2 || ly < -0.25 || lz > 0.42 || lz < -0.2)) return b;
  let h = headSDF(dx, ly, lz);
  let d = smin(b, h, 0.025);
  d = smax(d, -cavitySDF(dx, ly, lz), 0.0015);
  return d;
}

// Split between the high-resolution head mesh and the body mesh.
// t > 0 towards the head. Returns signed distance along the neck axis.
const SPLIT_P = headToWorld([0, -0.105, 0]);
const SPLIT_N = (() => {
  const a = NECK2, b = HEAD_POS;
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
export function splitT(x, y, z) {
  return (x - SPLIT_P[0]) * SPLIT_N[0] + (y - SPLIT_P[1]) * SPLIT_N[1] + (z - SPLIT_P[2]) * SPLIT_N[2];
}
export const SPLIT_OVERLAP = 0.025;

export function bodyMeshSDF(x, y, z) {
  const t = splitT(x, y, z);
  if (t - SPLIT_OVERLAP > 0.02) return t - SPLIT_OVERLAP;
  const d = goatSDF(x, y, z) + smoothstep(-SPLIT_OVERLAP, -0.008, t) * 0.003;
  return Math.max(d, t - SPLIT_OVERLAP);
}
export function headMeshSDF(x, y, z) {
  const t = splitT(x, y, z);
  if (-SPLIT_OVERLAP - t > 0.02) return -SPLIT_OVERLAP - t;
  return Math.max(goatSDF(x, y, z), -SPLIT_OVERLAP - t);
}

// ------------------------------------------------------- surface attributes
// Per-vertex colour, fur length and material class, evaluated in bind space.

const C_FUR = [0.86, 0.83, 0.77];
const C_FUR_SHADE = [0.8, 0.76, 0.68];
const C_SKIN = [0.78, 0.6, 0.56];
const C_SKIN_DARK = [0.5, 0.42, 0.42];
const C_MUCOSA = [0.72, 0.36, 0.38];
const C_PAD = [0.8, 0.62, 0.58];

export const MAT_FUR = 0, MAT_SKIN = 1, MAT_MUCOSA = 2;

export function surfaceAttributes(x, y, z) {
  const [hx, hy, hz] = worldToHead(x, y, z);
  const inHead = splitT(x, y, z) > -0.02 && hz > -0.05;
  let col = C_FUR.slice();
  let fur = 1.0;
  let mat = MAT_FUR;
  let nostrilMask = 0, cheekMask = 0;

  // fur length map (cm-ish scale factors): longer along the back and on the
  // hind quarters ("britches"), short on the face and lower legs
  fur *= mix(0.7, 1.4, smoothstep(0.6, 0.78, y));
  fur *= mix(1, 1.5, smoothstep(-0.2, -0.4, z) * smoothstep(0.4, 0.6, y));
  fur *= mix(0.35, 1, smoothstep(0.12, 0.45, y)); // short on lower legs
  // slight cream tint along the back, white belly
  const n = noise3(x * 9, y * 9, z * 9);
  col = col.map((c, i) => mix(c, C_FUR_SHADE[i], 0.25 + 0.2 * n));

  // udder & teats: sparse hair, pink-grey skin
  const udder = sdEllipsoid(x, y, z, 0, 0.42, -0.24, 0.085, 0.085, 0.09);
  if (udder < 0.01) {
    const t = smoothstep(0.01, -0.02, udder);
    col = col.map((c, i) => mix(c, C_SKIN[i], t));
    fur *= 1 - 0.9 * t;
    if (t > 0.5) mat = MAT_SKIN;
  }

  if (inHead) {
    fur *= 0.45;
    // muzzle: short fine hair, pink/grey mottled skin around nostrils & lips
    const muzzleT = smoothstep(0.18, 0.25, hz);
    fur *= 1 - 0.85 * muzzleT;
    const mottle = 0.5 + 0.5 * noise3(x * 140, y * 140, z * 140);
    const skinCol = C_SKIN.map((c, i) => mix(c, C_SKIN_DARK[i], mottle * 0.6));
    const nose = smoothstep(0.238, 0.262, hz) * smoothstep(-0.03, 0.0, hy);
    const lips = smoothstep(0.008, 0.003, Math.abs(hy - MOUTH_Y)) * smoothstep(0.215, 0.24, hz);
    const skinT = Math.max(nose, lips, muzzleT * 0.35);
    col = col.map((c, i) => mix(c, skinCol[i], skinT));
    if (skinT > 0.55) mat = MAT_SKIN;
    // around the eyes: thinner hair, skin shows through
    const eyeD = Math.min(
      sdSphere(hx, hy, hz, 0.052, 0.027, 0.1, 0.019),
      sdSphere(hx, hy, hz, -0.052, 0.027, 0.1, 0.019)
    );
    if (eyeD < 0.006) {
      const t = smoothstep(0.006, 0.0, eyeD) * 0.5;
      col = col.map((c, i) => mix(c, C_SKIN[i], t));
      fur *= 1 - t;
    }
    // inside the mouth: wet mucosa, pale dental pad at the front roof
    const cav = cavitySDF(hx, hy, hz);
    if (cav < 0.0016) {
      mat = MAT_MUCOSA;
      fur = 0;
      const pad = smoothstep(0.215, 0.232, hz) * (hy > MOUTH_Y ? 1 : 0);
      col = C_MUCOSA.map((c, i) => mix(c, C_PAD[i], pad));
      col = col.map((c) => c * (0.8 + 0.2 * mottle));
    }
    // nostril interiors
    const nos = Math.min(nostrilL(hx, hy, hz), nostrilR(hx, hy, hz));
    nostrilMask = smoothstep(0.006, 0.0015, nos) * smoothstep(-0.001, 0.0015, nos);
    // buccal (cheek) region: bulges when a bolus is pushed into the cheek
    cheekMask = smoothstep(0.075, 0.1, hz) * smoothstep(0.19, 0.155, hz) *
      smoothstep(-0.062, -0.045, hy) * smoothstep(-0.005, -0.02, hy) * smoothstep(0.018, 0.03, Math.abs(hx));
    if (cav < 0.0016) cheekMask = 0;
    cheekMask *= Math.sign(hx);
    if (nos < 0.002) {
      mat = MAT_SKIN;
      fur = 0;
      col = [0.25, 0.14, 0.14];
    }
  }
  return { col, fur: clamp(fur, 0, 2), mat, aux: [nostrilMask, cheekMask] };
}

// --------------------------------------------------------------- skinning
// Weights are a single global function so the head and body meshes agree
// exactly where they overlap.

export function jawWeight(hx, hy, hz) {
  const mouthY = hz > 0.09 ? slitCenterY(hz) : mix(-0.006, slitCenterY(0.09), smoothstep(0.045, 0.09, hz));
  const dy = hy - mouthY;
  // in front of the commissure the lips separate cleanly; behind it the cheek
  // skin is continuous and stretches over a wide band
  const behind = smoothstep(COMMISSURE_Z + 0.004, COMMISSURE_Z - 0.012, hz);
  const w = mix(0.0015, mix(0.014, 0.034, smoothstep(COMMISSURE_Z - 0.01, 0.12, hz)), behind);
  let jw = 1 - smoothstep(-w, w, dy);
  jw *= smoothstep(0.0, 0.035, hz);
  jw *= smoothstep(-0.108, -0.078, hy);
  return jw;
}
