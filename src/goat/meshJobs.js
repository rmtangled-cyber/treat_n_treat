// Mesh generation jobs. Run inside Web Workers (see meshWorker.js) so the
// body and head meshes are sculpted in parallel at load time.

import { meshSDF } from '../sdf.js';
import * as A from './anatomy.js';
import * as P from './parts.js';
import { handSDF, handColor } from '../hand.js';

function headBoxWorld() {
  const pts = [];
  for (const x of [-0.09, 0.09]) for (const y of [-0.135, 0.1]) for (const z of [-0.07, 0.285]) pts.push(A.headToWorld([x, y, z]));
  return [
    [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))),
    [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))),
  ];
}

function skinnedSurface(f, min, max, cell) {
  const m = meshSDF(f, min, max, cell);
  const n = m.positions.length / 3;
  const color = new Float32Array(n * 3);
  const fur = new Float32Array(n);
  const mat = new Uint8Array(n);
  const aux = new Float32Array(n * 2);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
    const a = A.surfaceAttributes(x, y, z);
    color.set(a.col, v * 3);
    fur[v] = a.fur;
    mat[v] = a.mat;
    aux[v * 2] = a.aux[0];
    aux[v * 2 + 1] = a.aux[1];
    const w = P.skinWeights(x, y, z);
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = w[k][0];
      skinWeight[v * 4 + k] = w[k][1];
    }
  }
  // sort triangles into material groups
  const tri = m.indices;
  const buckets = [[], [], []];
  for (let t = 0; t < tri.length; t += 3) {
    const g = Math.max(mat[tri[t]], mat[tri[t + 1]], mat[tri[t + 2]]);
    buckets[g].push(tri[t], tri[t + 1], tri[t + 2]);
  }
  const all = buckets.flat();
  const indices = n > 65535 ? new Uint32Array(all) : new Uint16Array(all);
  const groups = [];
  let start = 0;
  buckets.forEach((b, i) => {
    if (b.length) groups.push({ start, count: b.length, materialIndex: i });
    start += b.length;
  });
  return { positions: m.positions, normals: m.normals, indices, color, fur, aux, skinIndex, skinWeight, groups };
}

function plain(f, min, max, cell, colorFn) {
  const m = meshSDF(f, min, max, cell);
  const out = { positions: m.positions, normals: m.normals, indices: m.indices };
  if (colorFn) {
    const n = m.positions.length / 3;
    out.color = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) out.color.set(colorFn(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]), v * 3);
  }
  return out;
}

export function runJob(name) {
  if (name === 'body') {
    return skinnedSurface(A.bodyMeshSDF, [-0.23, -0.01, -0.58], [0.23, 1.1, 0.64], 0.007);
  }
  if (name === 'head') {
    const [mn, mx] = headBoxWorld();
    return skinnedSurface(A.headMeshSDF, mn, mx, 0.0025);
  }
  if (name === 'parts') {
    const lowerTeeth = plain(P.lowerTeethSDF, [-0.032, -0.06, 0.065], [0.032, -0.02, 0.25], 0.00072);
    const upperTeeth = plain(P.upperTeethSDF, [-0.03, -0.035, 0.065], [0.03, -0.015, 0.165], 0.0008);
    const tongue = plain(P.tongueSDF, [-0.02, -0.056, 0.03], [0.02, -0.025, 0.245], 0.0011);
    {
      const n = tongue.positions.length / 3;
      tongue.skinIndex = new Uint16Array(n * 4);
      tongue.skinWeight = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) {
        const w = P.tongueWeights(tongue.positions[v * 3], tongue.positions[v * 3 + 1], tongue.positions[v * 3 + 2]);
        for (let k = 0; k < 4; k++) {
          tongue.skinIndex[v * 4 + k] = w[k][0];
          tongue.skinWeight[v * 4 + k] = w[k][1];
        }
      }
    }
    const ear = plain(P.earSDF, [-0.032, -0.02, -0.012], [0.032, 0.135, 0.012], 0.0016, P.earColor);
    const hoof = plain(P.hoofSDF, [-0.03, -0.025, -0.03], [0.03, 0.035, 0.04], 0.0015);
    const wattle = plain(P.wattleSDF, [-0.012, -0.055, -0.012], [0.012, 0.008, 0.016], 0.0012);
    return { lowerTeeth, upperTeeth, tongue, ear, hoof, wattle };
  }
  if (name === 'hand') {
    return plain(handSDF, [-0.045, -0.31, -0.22], [0.1, 0.06, 0.06], 0.0016, handColor);
  }
  throw new Error('unknown job ' + name);
}

export function transferables(obj, list = []) {
  if (ArrayBuffer.isView(obj)) list.push(obj.buffer);
  else if (obj && typeof obj === 'object') for (const k in obj) transferables(obj[k], list);
  return list;
}
