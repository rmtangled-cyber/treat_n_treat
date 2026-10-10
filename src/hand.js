// The player's right hand (first-person), sculpted as an SDF: a fist
// gripping a food item. The grip axis is local +Z (the food points that way);
// knuckles are on top (+Y), the forearm leaves the palm downward and back
// toward the player (-Y, -Z) with a rolled-up sleeve.
import { smin, smax, sdRoundCone, sdBox, sdEllipsoid, smoothstep, noise3 } from './sdf.js';

function finger(x, y, z, zf, r, len) {
  // phalanges curl from the knuckles (palm side +X, top) over and around the grip
  const a = [0.028, 0.016, zf];
  const b = [0.008 * len, 0.031 * len, zf + 0.002];
  const c = [-0.017 * len, 0.022 * len, zf + 0.003];
  const e = [-0.022 * len, 0.0, zf + 0.002];
  let d = sdRoundCone(x, y, z, ...a, ...b, r * 1.1, r);
  d = smin(d, sdRoundCone(x, y, z, ...b, ...c, r, r * 0.92), 0.004);
  d = smin(d, sdRoundCone(x, y, z, ...c, ...e, r * 0.92, r * 0.84), 0.003);
  return d;
}

export function handSDF(x, y, z) {
  // palm block on the +X side of the grip, long axis downward
  let d = sdBox(x, y, z, 0.034, -0.012, 0.0, 0.013, 0.034, 0.04, 0.012);
  d = smin(d, sdEllipsoid(x, y, z, 0.026, -0.03, 0.026, 0.022, 0.026, 0.02), 0.01); // thenar eminence
  d = smin(d, finger(x, y, z, 0.026, 0.0088, 1.0), 0.006);
  d = smin(d, finger(x, y, z, 0.007, 0.0094, 1.04), 0.004);
  d = smin(d, finger(x, y, z, -0.012, 0.009, 1.0), 0.004);
  d = smin(d, finger(x, y, z, -0.029, 0.0078, 0.88), 0.004);
  // thumb wraps under the grip from the index side
  d = smin(d, sdRoundCone(x, y, z, 0.03, -0.03, 0.03, 0.006, -0.027, 0.036, 0.0125, 0.0095), 0.008);
  d = smin(d, sdRoundCone(x, y, z, 0.006, -0.027, 0.036, -0.016, -0.012, 0.033, 0.0095, 0.0085), 0.004);
  // wrist + forearm (down and back toward the player's shoulder)
  d = smin(d, sdRoundCone(x, y, z, 0.034, -0.042, -0.004, 0.044, -0.13, -0.07, 0.026, 0.029), 0.02);
  d = smin(d, sdRoundCone(x, y, z, 0.044, -0.13, -0.07, 0.055, -0.27, -0.17, 0.029, 0.036), 0.02);
  // carve the grip channel so the food fits
  d = smax(d, -(Math.hypot(x, y) - 0.0125), 0.003);
  if (d < 0.003) d += 0.0002 * noise3(x * 300, y * 300, z * 300);
  return d;
}

export function handColor(x, y, z) {
  const sleeve = smoothstep(-0.15, -0.165, y);
  const n = noise3(x * 120, y * 120, z * 120);
  const knuckle = smoothstep(0.004, 0, Math.abs(y - 0.03)) * 0.06;
  const skin = [0.86 + 0.04 * n - knuckle, 0.64 + 0.03 * n - knuckle * 1.4, 0.53 + 0.03 * n - knuckle];
  const k = 0.8 + 0.2 * noise3(x * 200, y * 200, z * 200);
  const cloth = [0.22 * k, 0.32 * k, 0.45 * k];
  return skin.map((c, i) => c * (1 - sleeve) + cloth[i] * sleeve);
}
