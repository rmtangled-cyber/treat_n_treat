// Hand-held foods. Carrot and apple are SDF-sculpted and re-meshed after each
// bite so the scalloped bite marks (and the paler core of the carrot / the
// cream flesh of the apple) show where the goat's incisors went through.
import * as THREE from 'three';
import { meshSDF, smax, smin, clamp, noise3, smoothstep, sdSphere, mix } from './sdf.js';
import { strandsGeometry, rng } from './goat/GoatBuilder.js';
import { MOUTH_Y } from './goat/anatomy.js';
import { srgbToLinear } from './jobs.js';

// Chewing behaviour per food. chews: [min,max] per mouthful.
// hardness drives crunch energy; wetness drives squelch / juice; fibre drives
// the dry rustly crackle of stems and hay.
export const FOOD_TYPES = [
  {
    id: 'carrot', label: 'ニンジン', key: '1',
    profile: { chews: [15, 21], hardness: 1.0, wetness: 0.3, fibre: 0.1, color: 0xf07a1a, crumbs: 0.6, bite: 'snap' },
  },
  {
    id: 'apple', label: 'リンゴ', key: '2',
    profile: { chews: [10, 14], hardness: 0.72, wetness: 1.0, fibre: 0.0, color: 0xf1e2b0, crumbs: 0.35, bite: 'apple' },
  },
  {
    id: 'hay', label: '干し草', key: '3',
    profile: { chews: [30, 40], hardness: 0.35, wetness: 0.08, fibre: 1.0, color: 0xc9b46a, crumbs: 0.15, bite: 'pull' },
  },
  {
    id: 'leaf', label: '桑の葉', key: '4',
    profile: { chews: [18, 25], hardness: 0.42, wetness: 0.55, fibre: 0.5, color: 0x4f7d2c, crumbs: 0.1, bite: 'tear' },
  },
];

function geoFromMesh(m, colorFn) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const n = m.positions.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(colorFn(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(col), 3));
  return g;
}

// ------------------------------------------------------------------ carrot
class Carrot {
  constructor() {
    this.type = FOOD_TYPES[0];
    this.root = new THREE.Group();
    this.mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.2 });
    this.mesh = new THREE.Mesh(undefined, this.mat);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    // leafy stub at the crown, poking out behind the fist
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a2a, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0025, 0.05, 5), leaf);
      s.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      s.rotation.z = (Math.random() - 0.5) * 0.6;
      s.position.set((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008, -0.03);
      this.root.add(s);
    }
    this.reset();
  }
  reset() {
    this.L0 = 0.18;
    this.front = this.L0 + 0.01;
    this.seed = 0;
    this.bitesLeft = 4;
    this.rebuild();
  }
  sdf = (x, y, z) => {
    const L0 = this.L0;
    const t = clamp(z / L0, 0, 1);
    const r = 0.0158 * Math.pow(1 - t, 0.72) + 0.0016;
    const rho = Math.hypot(x, y);
    let d = (rho - r) * 0.96;
    // horizontal growth rings and root-hair dimples
    d += 0.00035 * Math.sin(z * 560 + 2.5 * noise3(x * 150, y * 150, z * 30));
    d += 0.0004 * Math.max(0, noise3(x * 260, y * 260, z * 260) - 0.55) * 4;
    d = smax(d, -z - 0.035, 0.003);
    d = smax(d, z - L0, 0.0015);
    if (this.front < L0) {
      const a = Math.atan2(y, x);
      const wave = 0.0022 * Math.sin(a * 3 + this.seed) + 0.0011 * Math.sin(a * 8 + this.seed * 2) + y * 0.18;
      d = smax(d, z - (this.front + wave), 0.0012);
    }
    return d;
  };
  color = (x, y, z) => {
    const t = clamp(z / this.L0, 0, 1);
    const r = 0.0158 * Math.pow(1 - t, 0.72) + 0.0016;
    const q = Math.hypot(x, y) / r;
    const n = noise3(x * 300, y * 300, z * 300) * 0.04;
    if (q > 0.86) return [0.93 + n, 0.42 + n, 0.07];
    if (q > 0.55) return [0.97 + n, 0.5 + n, 0.1];
    return [1.0, 0.66 + n, 0.22]; // paler xylem core
  };
  rebuild() {
    const m = meshSDF(this.sdf, [-0.019, -0.019, -0.04], [0.019, 0.019, Math.min(this.front, this.L0) + 0.006], 0.0011);
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    this.mesh.geometry = geoFromMesh(m, this.color);
  }
  getBitePoint(out) {
    const z = Math.min(this.front, this.L0) - 0.006;
    return this.root.localToWorld(out.set(0, 0.004, z));
  }
  takeBite() {
    if (this.bitesLeft <= 0) return null;
    this.bitesLeft--;
    this.front = Math.min(this.front, this.L0) - 0.032;
    this.seed = Math.random() * 6;
    this.rebuild();
    return { mouthItem: null };
  }
}

// ------------------------------------------------------------------ apple
class AppleSlice {
  constructor() {
    this.type = FOOD_TYPES[1];
    this.root = new THREE.Group();
    this.mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    this.mesh = new THREE.Mesh(undefined, this.mat);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.reset();
  }
  reset() {
    this.front = 0.08;
    this.seed = 0;
    this.bitesLeft = 3;
    this.rebuild();
  }
  // apple axis along local Z; wedge opens toward +Y (skin on top), held at -Z end
  sdf = (x, y, z) => {
    const zc = z - 0.03;
    let d = sdSphere(x, y, zc * 0.92, 0, -0.012, 0, 0.044);
    const a = 0.42; // half angle
    const n1 = x * Math.cos(a) - (y + 0.012) * Math.sin(a);
    const n2 = -x * Math.cos(a) - (y + 0.012) * Math.sin(a);
    d = smax(d, Math.max(n1, n2), 0.0015);
    d = smax(d, -(Math.hypot(x, y + 0.012) - 0.013), 0.002); // core removed
    if (this.front < 0.075) {
      const ang = Math.atan2(x, y);
      const wave = 0.003 * Math.sin(ang * 5 + this.seed) + 0.0015 * Math.sin(ang * 13 + this.seed);
      d = smax(d, z - (this.front + wave), 0.0015);
    }
    return d;
  };
  color = (x, y, z) => {
    const zc = z - 0.03;
    const skin = Math.abs(sdSphere(x, y, zc * 0.92, 0, -0.012, 0, 0.044));
    const n = noise3(x * 90, y * 90, z * 400);
    if (skin < 0.0012) return [0.72 + 0.15 * n, 0.12 + 0.12 * Math.max(0, n), 0.08];
    const ox = smoothstep(0.0, 0.004, this.front - z) < 1 && this.front < 0.075 ? 0.04 : 0;
    return [0.97 - ox, 0.91 - ox * 2, 0.7 - ox * 3];
  };
  rebuild() {
    const m = meshSDF(this.sdf, [-0.03, -0.004, -0.02], [0.03, 0.036, Math.min(this.front, 0.076) + 0.005], 0.001);
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    this.mesh.geometry = geoFromMesh(m, this.color);
  }
  getBitePoint(out) {
    return this.root.localToWorld(out.set(0, 0.016, Math.min(this.front, 0.074) - 0.008));
  }
  takeBite() {
    if (this.bitesLeft <= 0) return null;
    this.bitesLeft--;
    this.front = Math.min(this.front, 0.074) - 0.022;
    this.seed = Math.random() * 6;
    this.rebuild();
    return { mouthItem: null };
  }
}

// ------------------------------------------------------------------ hay
function hayColor(r) {
  const k = r();
  return k < 0.3 ? [0.78, 0.72, 0.42] : k < 0.6 ? [0.86, 0.78, 0.5] : k < 0.85 ? [0.7, 0.68, 0.38] : [0.62, 0.66, 0.36];
}
function hayStrands(n, seed, base, spread, lenRange, droop = 0.3) {
  const r = rng(seed);
  const strands = [];
  for (let i = 0; i < n; i++) {
    const len = lenRange[0] + r() * (lenRange[1] - lenRange[0]);
    const dir = new THREE.Vector3((r() - 0.5) * spread, (r() - 0.5) * spread * 0.6, 1).normalize();
    const b = base.clone().add(new THREE.Vector3((r() - 0.5) * 0.012, (r() - 0.5) * 0.012, (r() - 0.5) * 0.02));
    const bend = new THREE.Vector3((r() - 0.5) * 0.4, -droop * (0.5 + r()), 0);
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const t = k / 5;
      pts.push(b.clone().addScaledVector(dir, len * t).addScaledVector(bend, len * t * t * 0.5));
    }
    strands.push({ points: pts, r0: 0.0011 + r() * 0.0006, r1: 0.0005, shade: 0.8 + 0.25 * r(), color: hayColor(r) });
  }
  return strands;
}
function strandsMesh(strands) {
  // colour per strand: build groups manually by merging per-colour
  const byCol = new Map();
  for (const s of strands) {
    const k = s.color.join(',');
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k).push(s);
  }
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  for (const [k, list] of byCol) {
    const m = new THREE.Mesh(strandsGeometry(list, k.split(',').map(Number)), mat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

class HayTuft {
  constructor() {
    this.type = FOOD_TYPES[2];
    this.root = new THREE.Group();
    this.reset();
  }
  reset() {
    this.bitesLeft = 4;
    this.strands = hayStrands(90, 3, new THREE.Vector3(0, 0, -0.02), 0.5, [0.12, 0.22], 0.25);
    this.rebuild();
  }
  rebuild() {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.mesh = strandsMesh(this.strands);
    this.root.add(this.mesh);
  }
  getBitePoint(out) {
    // where the tips are densest
    const c = new THREE.Vector3();
    let n = 0;
    for (const s of this.strands) {
      const p = s.points[4];
      c.add(p);
      n++;
    }
    c.multiplyScalar(1 / Math.max(n, 1));
    return this.root.localToWorld(out.copy(c));
  }
  takeBite() {
    if (this.bitesLeft <= 0) return null;
    this.bitesLeft--;
    const take = Math.ceil(this.strands.length / (this.bitesLeft + 1));
    this.strands.sort((a, b) => b.points[5].z - a.points[5].z);
    this.strands.splice(0, take);
    this.rebuild();
    return { mouthItem: makeMouthHay() };
  }
}

// strands hanging from the goat's lips (head-local, attached to the jaw)
function makeMouthHay() {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const strands = hayStrands(7, side > 0 ? 11 : 12, new THREE.Vector3(0.006 * side, MOUTH_Y - 0.002, 0.2), 1.0, [0.06, 0.12], 0.6);
    for (const s of strands) for (const p of s.points) p.x += Math.abs(p.z - 0.2) * 0.9 * side;
    g.add(strandsMesh(strands));
  }
  g.userData.kind = 'strands';
  return g;
}

// ------------------------------------------------------------------ mulberry leaves
let leafTex = null;
function getLeafTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 320);
  // ovate, serrated, cordate base (mulberry)
  x.beginPath();
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ang = t * Math.PI * 2;
    const yy = Math.cos(ang);
    const along = (1 - yy) / 2; // 0 at base, 1 at tip
    let w = Math.sin(Math.PI * Math.pow(along, 0.85)) * (1 - 0.25 * along) * 112;
    w *= 1 + 0.04 * Math.sin(t * 2 * Math.PI * 34); // serration
    const cord = along < 0.08 ? (0.08 - along) * 300 : 0;
    const px = 128 + Math.sign(Math.sin(ang)) * w;
    const py = 300 - along * 290 + cord * 0.3;
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
  const grd = x.createLinearGradient(0, 0, 256, 320);
  grd.addColorStop(0, '#4f8a2e');
  grd.addColorStop(1, '#3a6b22');
  x.fillStyle = grd;
  x.fill();
  // veins
  x.strokeStyle = 'rgba(190,220,140,0.65)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(128, 300);
  x.lineTo(128, 14);
  x.stroke();
  x.lineWidth = 1.6;
  for (let i = 0; i < 7; i++) {
    const y0 = 270 - i * 36;
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(128, y0);
      x.quadraticCurveTo(128 + s * 50, y0 - 18, 128 + s * (95 - i * 9), y0 - 45);
      x.stroke();
    }
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  return leafTex;
}
function leafMesh(size) {
  const g = new THREE.PlaneGeometry(size * 0.8, size, 6, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, -Math.abs(x) * 0.25 + Math.sin((y / size) * Math.PI) * 0.004);
  }
  g.computeVertexNormals();
  g.translate(0, size / 2, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: getLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6,
  }));
  m.castShadow = true;
  return m;
}

class LeafBranch {
  constructor() {
    this.type = FOOD_TYPES[3];
    this.root = new THREE.Group();
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.8 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -0.03), new THREE.Vector3(0.004, 0.004, 0.08),
      new THREE.Vector3(-0.004, 0.012, 0.18), new THREE.Vector3(0.002, 0.024, 0.26),
    ]);
    this.curve = curve;
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.0035, 6), stemMat);
    stem.castShadow = true;
    this.root.add(stem);
    this.reset();
  }
  reset() {
    if (this.leaves) for (const l of this.leaves) this.root.remove(l);
    this.leaves = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = 0.35 + (i / (n - 1)) * 0.62;
      const p = this.curve.getPointAt(t);
      const pivot = new THREE.Group();
      pivot.position.copy(p);
      const side = i % 2 ? 1 : -1;
      pivot.rotation.set(-0.9, 0, side * (0.9 + Math.random() * 0.3));
      const leaf = leafMesh(0.075 + Math.random() * 0.02);
      pivot.add(leaf);
      this.root.add(pivot);
      this.leaves.push(pivot);
    }
    this.bitesLeft = this.leaves.length;
  }
  getBitePoint(out) {
    const l = this.leaves[this.leaves.length - 1];
    if (!l) return this.root.localToWorld(out.set(0, 0.02, 0.24));
    return l.localToWorld(out.set(0, 0.04, 0.004));
  }
  takeBite() {
    if (this.bitesLeft <= 0) return null;
    this.bitesLeft--;
    const l = this.leaves.pop();
    this.root.remove(l);
    // the leaf ends up sticking out of the goat's mouth
    const g = new THREE.Group();
    const leaf = leafMesh(0.08);
    leaf.rotation.set(-Math.PI / 2 + 0.4, 0, 0.2);
    leaf.position.set(0, MOUTH_Y, 0.205);
    g.add(leaf);
    g.userData.kind = 'leaf';
    return { mouthItem: g };
  }
}

export function createFoods() {
  return [new Carrot(), new AppleSlice(), new HayTuft(), new LeafBranch()];
}
