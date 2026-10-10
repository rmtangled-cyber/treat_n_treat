// Signed-distance-field helpers and a narrow-band "surface nets" mesher.
// The goat, its hands-on food and the player's hand are all sculpted as SDFs
// (smooth unions of anatomical primitives) and polygonised here at load time.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Polynomial smooth min / max (Inigo Quilez).
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function sdSphere(x, y, z, cx, cy, cz, r) {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// Axis-aligned ellipsoid (bound approximation, good near the surface).
export function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// Round cone between a (radius ra) and b (radius rb) — the workhorse for
// limbs, neck and tapering body parts.
export function sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const z0 = yy - l2;
  const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
  const x2 = cx * cx + cy * cy + cz * cz;
  const y2 = yy * yy * l2;
  const z2 = z0 * z0 * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
}

export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

export function sdBox(x, y, z, cx, cy, cz, hx, hy, hz, r = 0) {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

// Ellipsoid with arbitrary orientation. `m` is a row-major 3x3 world->local rotation.
export function makeOrientedEllipsoid(c, r, m) {
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const lx = m[0] * dx + m[1] * dy + m[2] * dz;
    const ly = m[3] * dx + m[4] * dy + m[5] * dz;
    const lz = m[6] * dx + m[7] * dy + m[8] * dz;
    return sdEllipsoid(lx, ly, lz, 0, 0, 0, r[0], r[1], r[2]);
  };
}

// Rotation helpers producing world->local matrices (row-major).
export function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
export function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
export function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
export function mulM(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

// Value noise used to add organic irregularity to surfaces.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz);
  const c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1);
  const g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x1 = mix(a, b, ux), x2 = mix(c, d, ux), x3 = mix(e, f, ux), x4 = mix(g, h, ux);
  return mix(mix(x1, x2, uy), mix(x3, x4, uy), uz) * 2 - 1;
}

/**
 * Polygonise an SDF with naive surface nets.
 * A coarse pre-pass skips exact evaluation far from the surface, so fine
 * resolutions stay cheap. Vertices are projected onto the iso-surface and
 * normals come from the analytic-ish SDF gradient for smooth shading.
 */
export function meshSDF(f, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;

  // --- coarse pass
  const C = 4;
  const cnx = Math.ceil((nx - 1) / C) + 2, cny = Math.ceil((ny - 1) / C) + 2, cnz = Math.ceil((nz - 1) / C) + 2;
  const coarse = new Float32Array(cnx * cny * cnz);
  const cc = cell * C;
  for (let k = 0; k < cnz; k++)
    for (let j = 0; j < cny; j++)
      for (let i = 0; i < cnx; i++)
        coarse[i + cnx * (j + cny * k)] = f(min[0] + i * cc, min[1] + j * cc, min[2] + k * cc);
  const band = cc * 1.3;

  // --- fine grid
  const grid = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const ck = Math.floor(k / C), tk = (k % C) / C;
    for (let j = 0; j < ny; j++) {
      const cj = Math.floor(j / C), tj = (j % C) / C;
      for (let i = 0; i < nx; i++) {
        const ci = Math.floor(i / C), ti = (i % C) / C;
        const i000 = ci + cnx * (cj + cny * ck);
        const c000 = coarse[i000], c100 = coarse[i000 + 1];
        const c010 = coarse[i000 + cnx], c110 = coarse[i000 + cnx + 1];
        const o = cnx * cny;
        const c001 = coarse[i000 + o], c101 = coarse[i000 + o + 1];
        const c011 = coarse[i000 + o + cnx], c111 = coarse[i000 + o + cnx + 1];
        const v = mix(
          mix(mix(c000, c100, ti), mix(c010, c110, ti), tj),
          mix(mix(c001, c101, ti), mix(c011, c111, ti), tj),
          tk
        );
        grid[i + nx * (j + ny * k)] =
          Math.abs(v) > band ? v : f(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
      }
    }
  }

  // --- surface nets vertices
  const vidx = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  const offs = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = offs[c];
          const v = grid[i + o[0] + nx * (j + o[1] + ny * (k + o[2]))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = offs[a], ob = offs[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          n++;
        }
        vidx[i + nx * (j + ny * k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }

  // --- faces
  const idx = [];
  const at = (i, j, k) => grid[i + nx * (j + ny * k)];
  const V = (i, j, k) => vidx[i + nx * (j + ny * k)];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v0 = at(i, j, k);
        const inside = v0 < 0;
        // x-edge
        if (i < nx - 1 && inside !== at(i + 1, j, k) < 0) {
          const a = V(i, j - 1, k - 1), b = V(i, j, k - 1), c = V(i, j, k), d = V(i, j - 1, k);
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, inside);
        }
        if (j < ny - 1 && inside !== at(i, j + 1, k) < 0) {
          const a = V(i - 1, j, k - 1), b = V(i - 1, j, k), c = V(i, j, k), d = V(i, j, k - 1);
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, inside);
        }
        if (k < nz - 1 && inside !== at(i, j, k + 1) < 0) {
          const a = V(i - 1, j - 1, k), b = V(i, j - 1, k), c = V(i, j, k), d = V(i - 1, j, k);
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, inside);
        }
      }
  function quad(a, b, c, d, flip) {
    if (flip) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  }

  // --- project to surface + gradient normals (tetrahedral 4-tap gradient)
  const P = new Float32Array(pos);
  const N = new Float32Array(P.length);
  const e = cell * 0.2;
  for (let v = 0; v < P.length; v += 3) {
    let x = P[v], y = P[v + 1], z = P[v + 2];
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it < 2; it++) {
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e);
      const c = f(x - e, y + e, z - e), d4 = f(x + e, y + e, z + e);
      gx = a - b - c + d4; gy = -a - b + c + d4; gz = -a + b - c + d4;
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const dist = (a + b + c + d4) * 0.25;
      const step = clamp(dist, -cell * 0.6, cell * 0.6);
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    P[v] = x; P[v + 1] = y; P[v + 2] = z;
    N[v] = gx; N[v + 1] = gy; N[v + 2] = gz;
  }
  const I = P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions: P, normals: N, indices: I };
}
