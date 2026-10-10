// Assembles the goat: skeleton, skinned body/head (+ shell fur), tongue,
// teeth, eyes with lids, ears, horns, beard, wattles and hooves.
import * as THREE from 'three';
import {
  BONES, boneWorldPositions, isHeadFrameBone, HEAD_PITCH, headToWorld, goatSDF,
  EYE_C, EYE_R, JAW_BIND_OPEN, EYE_GAZE, headSDF,
} from './anatomy.js';
import { createGoatMaterials, createShellMaterial, createEyeMaterial, goatUniforms } from './materials.js';
import { toGeometry, srgbToLinear } from '../jobs.js';

const HEAD_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HEAD_PITCH);

// head-local geometry -> world bind space
function headLocalToWorld(g) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...headToWorld([0, 0, 0])), HEAD_Q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

// ------------------------------------------------------------ horns
function hornGeometry(points, r0, r1, side) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const seg = 64, rad = 18;
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], nor = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const T = frames.tangents[i], N = frames.normals[i], B = frames.binormals[i];
    // annual growth rings + taper; laterally compressed with a front keel
    const ring = 1 + 0.045 * Math.sin(u * 70) * (1 - u);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(u, 0.85)) * ring;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const keel = 1 + 0.18 * Math.pow(Math.max(0, Math.cos(a)), 6);
      const ex = Math.cos(a) * r * keel, ey = Math.sin(a) * r * 0.78;
      const p = c.clone().addScaledVector(N, ex).addScaledVector(B, ey);
      const n = new THREE.Vector3().addScaledVector(N, Math.cos(a) / keel).addScaledVector(B, Math.sin(a) / 0.78).normalize();
      pos.push(p.x * side, p.y, p.z);
      nor.push(n.x * side, n.y, n.z);
      const streak = 0.85 + 0.15 * Math.sin(a * 7 + u * 3);
      const base = THREE.MathUtils.lerp(0.58, 0.74, u) * streak;
      col.push(base, base * 0.93, base * 0.82);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + rad + 1;
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(new Float32Array(col)), 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------ hair strands
export function strandsGeometry(strands, color) {
  const pos = [], col = [], idx = [];
  const sides = 3;
  for (const s of strands) {
    const base = pos.length / 3;
    const n = s.points.length;
    for (let i = 0; i < n; i++) {
      const p = s.points[i];
      const t = i / (n - 1);
      const r = THREE.MathUtils.lerp(s.r0, s.r1, t);
      const next = s.points[Math.min(i + 1, n - 1)], prev = s.points[Math.max(i - 1, 0)];
      const T = new THREE.Vector3().subVectors(next, prev).normalize();
      const A = new THREE.Vector3(0, 0, 1).cross(T);
      if (A.lengthSq() < 1e-4) A.set(1, 0, 0).cross(T);
      A.normalize();
      const B = new THREE.Vector3().crossVectors(T, A);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const q = p.clone().addScaledVector(A, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r);
        pos.push(q.x, q.y, q.z);
        const shade = THREE.MathUtils.lerp(0.75, 1.0, t) * s.shade;
        col.push(color[0] * shade, color[1] * shade, color[2] * shade);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < sides; k++) {
        const a = base + i * sides + k, b = base + i * sides + ((k + 1) % sides);
        idx.push(a, a + sides, b, b, a + sides, b + sides);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(new Float32Array(col)), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// march from `from` along `dir` until the goat surface is hit
export function surfacePoint(from, dir, max = 0.3) {
  let t = 0;
  for (let i = 0; i < 200 && t < max; i++) {
    const d = goatSDF(from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t);
    if (d < 0.0004) break;
    t += Math.max(d * 0.8, 0.0005);
  }
  return [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function basisQuat(yAxis, zHint) {
  const y = new THREE.Vector3(...yAxis).normalize();
  const z = new THREE.Vector3(...zHint);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// ------------------------------------------------------------ build
export function buildGoat({ furShells = 14, results }) {
  const { body, head, parts } = results;

  const group = new THREE.Group();
  group.name = 'goat';

  // skeleton
  const W = boneWorldPositions();
  const bones = {};
  const boneList = [];
  for (const b of BONES) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    if (!b.parent) {
      bone.position.set(...b.pos);
      group.add(bone);
    } else {
      const parent = bones[b.parent];
      parent.add(bone);
      if (b.local) bone.position.set(...b.local);
      else {
        const pw = W[b.parent];
        const v = new THREE.Vector3(b.pos[0] - pw[0], b.pos[1] - pw[1], b.pos[2] - pw[2]);
        if (isHeadFrameBone(b.parent)) v.applyQuaternion(HEAD_Q.clone().invert());
        bone.position.copy(v);
      }
      if (b.name === 'head') bone.quaternion.copy(HEAD_Q);
    }
    bone.userData.restQ = bone.quaternion.clone();
    bone.userData.restP = bone.position.clone();
    bones[b.name] = bone;
    boneList.push(bone);
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);

  const mats = createGoatMaterials();
  const bodyGeo = toGeometry(body, { skinned: true });
  const headGeo = toGeometry(head, { skinned: true });
  const meshes = [];
  // the body yields to the head mesh where they overlap on the neck
  const bodyMats = [mats.fur, mats.skin, mats.mucosa].map((m) => {
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    c.customProgramCacheKey = m.customProgramCacheKey;
    c.userData = m.userData;
    c.polygonOffset = true;
    c.polygonOffsetFactor = 1;
    c.polygonOffsetUnits = 4;
    return c;
  });
  mats.list.push(...bodyMats);
  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, bodyMats);
  const headMesh = new THREE.SkinnedMesh(headGeo, [mats.fur, mats.skin, mats.mucosa]);
  for (const m of [bodyMesh, headMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    m.bind(skeleton);
    meshes.push(m);
  }

  // shell fur
  const shells = [];
  for (let i = 1; i <= furShells; i++) {
    const mat = createShellMaterial(i / furShells);
    for (const g of [bodyGeo, headGeo]) {
      const s = new THREE.SkinnedMesh(g, mat);
      s.frustumCulled = false;
      s.renderOrder = 1;
      group.add(s);
      s.bind(skeleton, bodyMesh.bindMatrix);
      shells.push(s);
    }
  }

  // tongue (skinned to the tongue bone chain)
  const tongueGeo = toGeometry(parts.tongue, { skinned: true });
  // the tongue sits on the jaw, which is sculpted slightly dropped
  tongueGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.004, -0.046)
    .premultiply(new THREE.Matrix4().makeRotationX(JAW_BIND_OPEN))
    .premultiply(new THREE.Matrix4().makeTranslation(0, -0.004, 0.046)));
  headLocalToWorld(tongueGeo);
  const tongueMat = new THREE.MeshPhysicalMaterial({
    color: 0xc4707a, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2,
  });
  const tongue = new THREE.SkinnedMesh(tongueGeo, tongueMat);
  tongue.frustumCulled = false;
  group.add(tongue);
  tongue.bind(skeleton, bodyMesh.bindMatrix);

  // teeth
  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xeee6d2, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2,
  });
  const jawLocal = BONES.find((b) => b.name === 'jaw').local;
  const lowerTeeth = new THREE.Mesh(toGeometry(parts.lowerTeeth), enamel);
  lowerTeeth.position.set(-jawLocal[0], -jawLocal[1], -jawLocal[2]);
  const lowerPivot = new THREE.Group();
  lowerPivot.rotation.x = JAW_BIND_OPEN; // undo the runtime closing rotation
  lowerPivot.add(lowerTeeth);
  bones.jaw.add(lowerPivot);
  const upperTeeth = new THREE.Mesh(toGeometry(parts.upperTeeth), enamel);
  bones.head.add(upperTeeth);

  // eyes + lids
  const eyeGeo = new THREE.SphereGeometry(EYE_R, 48, 32).rotateX(Math.PI / 2);
  const eyeMat = createEyeMaterial();
  const lidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const eyes = [];
  const lidRimMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.5, sheenColor: new THREE.Color(0.9, 0.88, 0.84) });
  for (const side of [1, -1]) {
    const bone = bones[side > 0 ? 'eyeL' : 'eyeR'];
    const gaze = new THREE.Vector3(EYE_GAZE[0] * side, EYE_GAZE[1], EYE_GAZE[2]).normalize();
    const baseQ = basisQuat([0, 1, 0], [gaze.x, gaze.y, gaze.z]);
    // basisQuat builds a frame whose +Z = gaze (re-orthogonalised against +Y)
    const pivot = new THREE.Object3D();
    pivot.quaternion.copy(baseQ);
    bone.add(pivot);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    pivot.add(eye);
    const upper = new THREE.Mesh(lidGeometry(EYE_R + 0.0005, -110, 62, true), lidMat);
    const lower = new THREE.Mesh(lidGeometry(EYE_R + 0.0004, 128, 260, false), lidMat);
    pivot.add(upper, lower);
    // smooth almond-shaped lid rim hiding the socket edge
    const rim = new THREE.Mesh(lidRimGeometry(baseQ, side), lidRimMat);
    rim.castShadow = false;
    pivot.add(rim);
    eyes.push({ side, bone, pivot, eye, upper, lower, baseQ: baseQ.clone(), gaze });
  }

  // ears
  const earGeo = toGeometry(parts.ear);
  const earMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.75, sheen: 0.6, sheenColor: new THREE.Color(0.9, 0.88, 0.84),
    side: THREE.DoubleSide,
  });
  const ears = [];
  for (const side of [1, -1]) {
    const bone = bones[side > 0 ? 'earL' : 'earR'];
    // world-ish direction: up and out, slightly forward; inner face forward
    const dirW = new THREE.Vector3(0.85 * side, 0.42, 0.26);
    const faceW = new THREE.Vector3(0.2 * side, 0.25, 1);
    const inv = HEAD_Q.clone().invert();
    dirW.applyQuaternion(inv);
    faceW.applyQuaternion(inv);
    const q = basisQuat(dirW.toArray(), faceW.toArray());
    const ear = new THREE.Mesh(earGeo, earMat);
    ear.castShadow = true;
    ear.quaternion.copy(q);
    ear.scale.set(side < 0 ? -0.74 : 0.74, 0.74, 0.8);
    bone.add(ear);
    ears.push({ side, bone, mesh: ear });
  }

  // horns
  const hornMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, clearcoat: 0.08 });
  const hornPts = [
    [0.021, 0.056, 0.068], [0.024, 0.078, 0.045], [0.029, 0.088, 0.015],
    [0.036, 0.091, -0.015], [0.043, 0.087, -0.042], [0.048, 0.079, -0.062]
  ];
  for (const side of [1, -1]) {
    const h = new THREE.Mesh(hornGeometry(hornPts, 0.0155, 0.0035, side), hornMat);
    h.castShadow = true;
    bones.head.add(h);
  }

  // beard: hangs from the chin, moves with the lower jaw
  const beardPivot = new THREE.Object3D();
  beardPivot.position.set(0, -0.058 - jawLocal[1], 0.185 - jawLocal[2]);
  const beardBase = new THREE.Group();
  beardBase.rotation.x = JAW_BIND_OPEN;
  beardBase.add(beardPivot);
  bones.jaw.add(beardBase);
  {
    const r = rng(7);
    const strands = [];
    const down = new THREE.Vector3(0, -1, 0.08).applyQuaternion(HEAD_Q.clone().invert()).normalize();
    for (let i = 0; i < 340; i++) {
      const u = r(), v = r();
      const hz = 0.13 + u * 0.08;
      const hx = (v - 0.5) * 0.026 * (0.6 + 0.4 * u);
      // root on the skin under the jaw
      const from = headToWorld([hx, -0.13, hz]);
      const pw = surfacePoint(from, [0, 1, 0], 0.15);
      const local = new THREE.Vector3(pw[0], pw[1], pw[2]).sub(new THREE.Vector3(...headToWorld([0, 0, 0])))
        .applyQuaternion(HEAD_Q.clone().invert());
      local.sub(new THREE.Vector3(0, -0.058, 0.185));
      const len = 0.035 + 0.055 * Math.pow(u, 0.7) * (0.7 + 0.3 * r());
      const pts = [];
      const spread = new THREE.Vector3((r() - 0.5) * 0.25 + hx * 6, 0, (r() - 0.5) * 0.2);
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        const p = local.clone()
          .addScaledVector(down, len * t)
          .addScaledVector(spread, len * t * 0.5)
          .add(new THREE.Vector3(0, 0, -0.012 * t * t)); // gathers to a point
        pts.push(p);
      }
      // gather tips toward the beard's centre line
      const tip = pts[5];
      tip.x *= 0.5;
      strands.push({ points: pts, r0: 0.00065, r1: 0.00018, shade: 0.85 + 0.15 * r() });
    }
    const beard = new THREE.Mesh(strandsGeometry(strands, [0.93, 0.9, 0.82]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    beard.castShadow = true;
    beardPivot.add(beard);
  }

  // wattles: two skin tassels on the throat
  const wattleGeo = toGeometry(parts.wattle);
  const wattleMat = new THREE.MeshPhysicalMaterial({ color: 0xe9e2d6, roughness: 0.7, sheen: 0.5, sheenColor: 0xffffff });
  const wattles = [];
  for (const side of [1, -1]) {
    const from = [0.0145 * side, W.neck2[1] - 0.012, W.neck2[2]];
    const p = surfacePoint(from, [0, 0, 1], 0.2);
    const pivot = new THREE.Object3D();
    const nb = W.neck2;
    pivot.position.set(p[0] - nb[0], p[1] - nb[1], p[2] - nb[2] - 0.003);
    bones.neck2.add(pivot);
    const m = new THREE.Mesh(wattleGeo, wattleMat);
    m.castShadow = true;
    pivot.add(m);
    wattles.push({ pivot, vel: new THREE.Vector2(), ang: new THREE.Vector2() });
  }

  // hooves
  const hoofGeo = toGeometry(parts.hoof);
  const hoofMat = new THREE.MeshPhysicalMaterial({ color: 0x6e6256, roughness: 0.55, clearcoat: 0.2 });
  for (const n of ['hoofFL', 'hoofFR', 'hoofHL', 'hoofHR']) {
    const m = new THREE.Mesh(hoofGeo, hoofMat);
    m.castShadow = true;
    bones[n].add(m);
  }

  return {
    group, skeleton, bones, meshes, shells, tongue, eyes, ears, beardPivot, wattles,
    uniforms: goatUniforms, materials: mats, lowerTeeth, upperTeeth,
  };
}

// Almond-shaped torus around the eye opening (eye frame: x across, y up, z gaze).
function lidRimGeometry(frameQ, side) {
  // conforms to the skin: for each angle find how far out the face surface is
  const segU = 72, segV = 14;
  const pos = [], col = [], idx = [];
  const R = 0.0128;
  const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(frameQ);
  const ey = new THREE.Vector3(0, 1, 0).applyQuaternion(frameQ);
  const ez = new THREE.Vector3(0, 0, 1).applyQuaternion(frameQ);
  const c0 = new THREE.Vector3(EYE_C[0] * side, EYE_C[1], EYE_C[2]);
  const depthAt = (x, y) => {
    let t = 0.04;
    const p = new THREE.Vector3();
    while (t > -0.012) {
      p.copy(c0).addScaledVector(ex, x).addScaledVector(ey, y).addScaledVector(ez, t);
      if (headSDF(p.x, p.y, p.z) < 0) break;
      t -= 0.0002;
    }
    return t;
  };
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    const cx = Math.cos(u) * R, cy = Math.sin(u) * R * 0.82 - Math.cos(u) * 0.001;
    const rx = Math.cos(u), ry = Math.sin(u) / 0.82;
    const rl = Math.hypot(rx, ry);
    // where the eyeball meets the skin
    const depth = Math.max(depthAt(cx + (rx / rl) * 0.0035, cy + (ry / rl) * 0.0035), Math.sqrt(Math.max(0, 0.0145 ** 2 - R * R * 0.8)));
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const tube = 0.0027 * (1 + 0.3 * Math.max(0, Math.sin(u))); // fuller upper lid
      const r = Math.cos(v) * tube;
      pos.push(cx + (rx / rl) * r, cy + (ry / rl) * r, depth - 0.0016 + Math.sin(v) * tube * 0.6);
      // dark pigmented margin on the inner edge, furred skin outside
      const inner = Math.max(0, -Math.cos(v)) * Math.max(0, Math.sin(v) + 0.3);
      const m = Math.min(1, inner * 2.2);
      col.push(0.86 - 0.66 * m, 0.83 - 0.68 * m, 0.77 - 0.63 * m);
    }
  }
  for (let i = 0; i < segU; i++)
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j, b = a + segV + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(new Float32Array(col)), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Partial sphere for eyelids. Angles (degrees) measured in the eye's Y-Z plane
// from +Y toward +Z (gaze); the lid rotates about the eye's X axis to blink.
function lidGeometry(r, a0, a1, upper) {
  const segA = 36, segB = 28;
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segA; i++) {
    const phi = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a0, a1, i / segA));
    const edgeT = upper ? i / segA : 1 - i / segA; // 1 at the lid margin
    for (let j = 0; j <= segB; j++) {
      const th = 0.25 + (j / segB) * (Math.PI - 0.5);
      // slight thickening toward the margin
      const rr = r * (1 + 0.04 * Math.pow(edgeT, 8));
      const x = rr * Math.cos(th);
      const s = rr * Math.sin(th);
      pos.push(x, s * Math.cos(phi), s * Math.sin(phi));
      const margin = Math.pow(edgeT, 6);
      col.push(
        THREE.MathUtils.lerp(0.86, 0.2, margin),
        THREE.MathUtils.lerp(0.83, 0.15, margin),
        THREE.MathUtils.lerp(0.77, 0.14, margin)
      );
    }
  }
  for (let i = 0; i < segA; i++)
    for (let j = 0; j < segB; j++) {
      const a = i * (segB + 1) + j, b = a + segB + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(new Float32Array(col)), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
