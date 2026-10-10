// First-person player with a human range of motion:
//  - eye height: standing 1.58 m, half-crouch 1.15 m, squat 0.82 m (no lying
//    down, so you can never get under the goat)
//  - head pitch limited to -75°..+70°, lean (Q/E) up to 0.24 m
//  - the body is a capsule that collides with the goat's capsules, the fence
//    and props, so the view can never pass through the goat
import * as THREE from 'three';

const EYE = [1.58, 1.15, 0.82];
const EYE_LABEL = ['立ち', '中腰', 'しゃがみ'];
const PITCH_MIN = THREE.MathUtils.degToRad(-75);
const PITCH_MAX = THREE.MathUtils.degToRad(70);
const BODY_R = 0.26;
const HEAD_R = 0.14;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(0, 0, 1.9); // feet
    this.yaw = 0; // facing -Z toward the goat
    this.pitch = -0.12;
    this.stance = 0;
    this.eye = EYE[0];
    this.lean = 0;
    this.leanT = 0;
    this.keys = {};
    this.vel = new THREE.Vector3();
    this.bob = 0;
    this.stepAcc = 0;
    this.offer = 0;
    this.offering = false;
    this.focus = false;
    this.locked = false;
    this.touchActive = false; // set by the touch controls on phones/tablets
    this.moveInput = { x: 0, y: 0 }; // virtual joystick (right, forward), magnitude <= 1
    this.leanInput = 0;
    this.fov = camera.fov;
    this.onStep = null;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyC' && !e.repeat) this.cycleStance();
    });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    addEventListener('blur', () => (this.keys = {}));
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.offering = true;
      if (e.button === 2) this.focus = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.offering = false;
      if (e.button === 2) this.focus = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look(e.movementX, e.movementY, 0.0021);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.offering = this.focus = false;
    });
  }

  get active() {
    return this.locked || this.touchActive;
  }

  // dx/dy in pixels; scale = radians per pixel
  look(dx, dy, scale) {
    const s = scale * (this.focus ? 0.52 : 1);
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch));
  }

  cycleStance() {
    this.stance = (this.stance + 1) % 3;
  }

  get stanceLabel() {
    return EYE_LABEL[this.stance];
  }

  lock() {
    this.dom.requestPointerLock?.();
  }

  update(dt, colliders, world) {
    const k = this.keys;
    // movement in the horizontal plane
    const fwd = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (k.KeyW) wish.add(fwd);
    if (k.KeyS) wish.sub(fwd);
    if (k.KeyD) wish.add(right);
    if (k.KeyA) wish.sub(right);
    const speed = (k.ShiftLeft || k.ShiftRight ? 2.3 : 1.25) * [1, 0.6, 0.4][this.stance];
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    else if (this.moveInput.x || this.moveInput.y) {
      // joystick: walking speed follows how far the stick is pushed
      wish.addScaledVector(right, this.moveInput.x).addScaledVector(fwd, this.moveInput.y);
      const mag = Math.min(1, wish.length());
      wish.normalize().multiplyScalar(speed * mag * (mag > 0.97 ? 1.35 : 1));
    }
    this.vel.lerp(wish, 1 - Math.exp(-dt * 10));
    this.pos.addScaledVector(this.vel, dt);

    // crouch / lean
    this.eye += (EYE[this.stance] - this.eye) * (1 - Math.exp(-dt * 6));
    this.leanT = Math.max(-1, Math.min(1, (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0) + this.leanInput));
    this.lean += (this.leanT - this.lean) * (1 - Math.exp(-dt * 7));

    // collisions: body capsule vs goat capsules, fence ring, props
    for (let iter = 0; iter < 3; iter++) {
      for (const [a, b, r] of colliders) {
        const pa = _v.set(this.pos.x, 0.15, this.pos.z);
        const pb = _v2.set(this.pos.x, this.eye + 0.1, this.pos.z);
        const [c1, c2] = closestSegSeg(pa, pb, a, b);
        const d = c1.distanceTo(c2);
        const min = BODY_R + r;
        if (d < min) {
          const push = c1.sub(c2);
          push.y = 0;
          if (push.lengthSq() < 1e-8) push.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          push.normalize().multiplyScalar(min - d);
          this.pos.add(push);
        }
      }
    }
    const R = world.bounds.radius - 0.35;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > R) this.pos.multiplyScalar(R / rr);
    for (const box of world.boxes || []) pushOutOfBox(this.pos, box, BODY_R);

    // head bob from walking
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * sp * 5.2;
    this.stepAcc += dt * sp;
    if (this.stepAcc > 0.7) {
      this.stepAcc = 0;
      this.onStep && this.onStep(sp);
    }
    const bobY = Math.sin(this.bob * 2) * 0.012 * Math.min(1, sp);

    // lean: shift the head sideways, but never into the goat
    let lean = this.lean * 0.24;
    const rightNow = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (let i = 0; i < 6; i++) {
      const eye = new THREE.Vector3(this.pos.x, this.eye + bobY, this.pos.z).addScaledVector(rightNow, lean);
      let hit = false;
      for (const [a, b, r] of colliders) {
        if (distPointSeg(eye, a, b) < r + HEAD_R) hit = true;
      }
      if (!hit) break;
      lean *= 0.6;
    }
    this.camera.position.set(this.pos.x, this.eye + bobY - Math.abs(lean) * 0.12, this.pos.z).addScaledVector(rightNow, lean);
    this.camera.rotation.set(this.pitch, this.yaw, -this.lean * 0.12, 'YXZ');

    // focus (a closer look) narrows the field of view slightly
    const fovT = this.focus ? 38 : 70;
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.offer += ((this.offering ? 1 : 0) - this.offer) * (1 - Math.exp(-dt * 7));
  }
}

function closestSegSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const c = d1.dot(r), b = d1.dot(d2);
  const denom = a * e - b * b;
  s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
  t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
  }
  return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
}

function distPointSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

function pushOutOfBox(p, box, r) {
  // box: {cx, cz, hx, hz, rot}
  const c = Math.cos(-box.rot), s = Math.sin(-box.rot);
  const dx = p.x - box.cx, dz = p.z - box.cz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = THREE.MathUtils.clamp(lx, -box.hx, box.hx), qz = THREE.MathUtils.clamp(lz, -box.hz, box.hz);
  const ex = lx - qx, ez = lz - qz;
  const d = Math.hypot(ex, ez);
  if (d < r) {
    let nx, nz;
    if (d > 1e-6) {
      nx = ex / d;
      nz = ez / d;
    } else {
      nx = 1;
      nz = 0;
    }
    const nlx = qx + nx * r, nlz = qz + nz * r;
    const c2 = Math.cos(box.rot), s2 = Math.sin(box.rot);
    p.x = box.cx + nlx * c2 - nlz * s2;
    p.z = box.cz + nlx * s2 + nlz * c2;
  }
}
