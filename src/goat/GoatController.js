// Goat behaviour + procedural animation.
//
// Chewing model (ruminant, anisognathic): the narrow lower jaw only meets one
// upper tooth row at a time, so each cycle is
//   opening  -> jaw drops and swings toward the WORKING side
//   fast close on the working side
//   power stroke: teeth in contact, the jaw grinds back across toward the
//                 midline (this is when you hear the crunch)
// The working side switches every ~8-20 cycles. Ingestive chewing runs at
// ~1.4–1.6 Hz with irregular amplitude; rumination is slower (~1.1 Hz),
// longer and very regular (Williams et al. 2011; Domingue et al. 1991).
// Swallowed boluses travel down — and regurgitated cud travels up — the left
// jugular groove, which you can see as a moving bulge on the neck.
import * as THREE from 'three';
import { MOUTH_Y, HEAD_PITCH, boneWorldPositions, headToWorld, BONES, JAW_BIND_OPEN } from './anatomy.js';
import { surfacePoint } from './GoatBuilder.js';

const W = boneWorldPositions();
const LIPS_LOCAL = new THREE.Vector3(0, MOUTH_Y, 0.258); // head-local
const INCISOR_LOCAL = new THREE.Vector3(0, MOUTH_Y - 0.002, 0.242);
const JAW_LOCAL = new THREE.Vector3(...BONES.find((b) => b.name === 'jaw').local);
const UP = new THREE.Vector3(0, 1, 0);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const _sa = new THREE.Vector3();
class Spring3 {
  constructor(v, w = 7) {
    this.v = v.clone();
    this.vel = new THREE.Vector3();
    this.w = w;
  }
  update(target, dt, w = this.w) {
    const k = w * w, c = 2 * w;
    const steps = Math.ceil(dt / 0.008);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      _sa.subVectors(target, this.v).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(_sa, h);
      this.v.addScaledVector(this.vel, h);
    }
    return this.v;
  }
}

// chewing envelope (phase 0..1) — vertical opening and lateral position
function openCurve(p) {
  if (p < 0.38) return smooth(0, 0.38, p);
  if (p < 0.6) return 1 - 0.93 * smooth(0.38, 0.6, p);
  return 0.07 * (1 - smooth(0.6, 1.0, p));
}
function latCurve(p) {
  if (p < 0.38) return -0.25 + 1.15 * smooth(0.04, 0.38, p);
  if (p < 0.6) return 0.9 + 0.1 * smooth(0.38, 0.6, p);
  return 1 - 1.25 * smooth(0.6, 0.98, p);
}

export class GoatController {
  constructor(goat, audio) {
    this.g = goat;
    this.b = goat.bones;
    this.audio = audio;
    this.group = goat.group;
    this.pos = this.group.position;
    this.yaw = 0;
    this.speed = 0;
    this.turnVel = 0;
    this.gait = 0;
    this.gaitAmt = 0;
    this.walkTarget = null;

    this.time = 0;
    this.env = {};
    this.task = null;
    this.taskName = 'idle';
    this.mode = 'look';
    this.lookTarget = new THREE.Vector3(0, 1.5, 3);
    this.reachTarget = new THREE.Vector3();
    this.reachFace = new THREE.Vector3(0, 0, 1);
    this.lookWander = new THREE.Vector3();

    this.restMouthL = new THREE.Vector3(...headToWorld(LIPS_LOCAL.toArray()));
    this.neckBaseL = new THREE.Vector3(...W.neck0);
    this.restFaceL = new THREE.Vector3(0, -Math.sin(HEAD_PITCH), Math.cos(HEAD_PITCH));
    this.group.updateMatrixWorld(true);
    this.mouthS = new Spring3(this.group.localToWorld(this.restMouthL.clone()), 6);
    this.faceS = new Spring3(this.restFaceL.clone(), 6);

    this.headOff = { pitch: 0, yaw: 0, roll: 0, lift: 0, fwd: 0 };
    this.headOffT = { pitch: 0, yaw: 0, roll: 0, lift: 0, fwd: 0 };
    this.jaw = { open: 0, lat: 0, roll: 0, prot: 0 };
    this.jawT = { open: 0, lat: 0, roll: 0, prot: 0 };
    this.lip = { upper: 0, lower: 0, upperSide: 0 };
    this.lipT = { upper: 0, lower: 0, upperSide: 0 };
    this.tongue = { out: 0, curl: 0, side: 0, lift: 0 };
    this.tongueT = { out: 0, curl: 0, side: 0, lift: 0 };
    this.blink = 0;
    this.blinkTimer = rand(1, 4);
    this.blinkPhase = -1;
    this.nostril = 0;
    this.sniffing = 0;
    this.tailWag = 0;
    this.tailWagT = 0;
    this.earState = [{ swivel: 0, raise: 0, flick: 0, flickT: rand(2, 6) }, { swivel: 0, raise: 0, flick: 0, flickT: rand(2, 6) }];
    this.breathPhase = 0;
    this.breathRate = 0.32; // breaths per second (~19/min at rest)
    this.idleTime = 0;
    this.nextBleat = rand(14, 30);
    this.nextLook = 0;
    this.excitement = 0;

    this.chew = {
      active: false, phase: 0, rate: 1.5, side: 1, count: 0, total: 0, sideLeft: 10,
      amp: 0.16, ampLat: 1, profile: null, rumination: false, lastPhase: 0, times: [],
    };
    this.chewLog = [];
    this.totalChews = 0;
    this.mouthful = null;
    this.mouthItem = null;
    this.ruminating = false;
    this.bolus = { active: false, s: 0, dir: 1, dur: 1, t: 0 };
    this.buildEsophagus();

    this.jawTrace = [];
    this.status = { main: '', sub: '' };

    this.setupMouthChunks();
    this.setupCrumbs();
    this.restBone = {};
    for (const [n, bone] of Object.entries(this.b)) this.restBone[n] = { q: bone.userData.restQ, p: bone.userData.restP };
    for (const w of goat.wattles) w.restQ = w.pivot.quaternion.clone();
    this.beardVel = new THREE.Vector2();
    this.beardAng = new THREE.Vector2();
    this.prevHeadPos = new THREE.Vector3();
    this.prevHeadVel = new THREE.Vector3();
    this.headAcc = new THREE.Vector3();
  }

  // ------------------------------------------------------------- setup
  buildEsophagus() {
    // bind-space path along the LEFT jugular groove, pharynx -> thoracic inlet
    const axis = [
      headToWorld([0, -0.07, 0.03]),
      [0, W.neck2[1] - 0.02, W.neck2[2] + 0.005],
      [0, W.neck1[1], W.neck1[2] + 0.005],
      [0, 0.72, 0.37],
    ].map((a) => new THREE.Vector3(...a));
    const curve = new THREE.CatmullRomCurve3(axis);
    this.esoPts = [];
    for (let i = 0; i <= 24; i++) {
      const c = curve.getPointAt(i / 24);
      const dir = new THREE.Vector3(0.78, -0.05, 0.62).normalize();
      const s = surfacePoint(c.toArray(), dir.toArray(), 0.2);
      const p = new THREE.Vector3(...s).addScaledVector(dir, -0.006);
      this.esoPts.push(p);
    }
    this.esoCurve = new THREE.CatmullRomCurve3(this.esoPts);
  }

  setupMouthChunks() {
    const geo = new THREE.IcosahedronGeometry(0.0032, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rand(0.7, 1.3), p.getY(i) * rand(0.6, 1.1), p.getZ(i) * rand(0.8, 1.4));
    geo.computeVertexNormals();
    this.chunkMat = new THREE.MeshPhysicalMaterial({ color: 0xf07a1a, roughness: 0.35, clearcoat: 0.6 });
    this.chunks = new THREE.InstancedMesh(geo, this.chunkMat, 14);
    this.chunks.count = 0;
    this.chunks.frustumCulled = false;
    const cp = new THREE.Group();
    cp.rotation.x = JAW_BIND_OPEN;
    cp.add(this.chunks);
    this.b.jaw.add(cp);
    this.chunkSeeds = Array.from({ length: 14 }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
  }

  setupCrumbs() {
    const geo = new THREE.IcosahedronGeometry(0.0028, 0);
    this.crumbMat = new THREE.MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.6 });
    this.crumbs = new THREE.InstancedMesh(geo, this.crumbMat, 60);
    this.crumbs.castShadow = true;
    this.crumbs.frustumCulled = false;
    this.crumbData = Array.from({ length: 60 }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, rot: new THREE.Euler(), color: new THREE.Color() }));
    this.crumbCursor = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 60; i++) this.crumbs.setMatrixAt(i, zero);
  }

  // ------------------------------------------------------------- queries
  get mouthWorld() {
    return this.b.head.localToWorld(_v4.copy(LIPS_LOCAL));
  }
  getMouthPosition(out) {
    return this.b.head.localToWorld(out.copy(LIPS_LOCAL));
  }
  getBodyPosition(out) {
    return this.group.localToWorld(out.set(0.12, 0.55, -0.02));
  }

  // capsules (world) used for player collision: [a, b, radius]
  getColliders() {
    const g = this.group, h = this.b.head;
    return [
      [g.localToWorld(new THREE.Vector3(0, 0.6, -0.33)), g.localToWorld(new THREE.Vector3(0, 0.6, 0.3)), 0.21],
      [this.b.neck0.getWorldPosition(new THREE.Vector3()), this.b.neck2.getWorldPosition(new THREE.Vector3()), 0.085],
      [this.b.neck2.getWorldPosition(new THREE.Vector3()), h.getWorldPosition(new THREE.Vector3()), 0.07],
      [h.localToWorld(new THREE.Vector3(0, 0.0, 0.07)), h.localToWorld(new THREE.Vector3(0, -0.015, 0.24)), 0.07],
    ];
  }

  // ------------------------------------------------------------- tasks
  startTask(name, gen) {
    this.task = gen;
    this.taskName = name;
    gen.next(); // run to first yield
  }
  abortTask() {
    this.task = null;
    this.taskName = 'idle';
    this.mode = 'look';
    this.stopChewing();
    this.jawT.open = 0;
    this.lipT.upper = this.lipT.lower = 0;
    this.tongueT.out = 0;
    this.ruminating = false;
    Object.assign(this.headOffT, { pitch: 0, yaw: 0, roll: 0, lift: 0, fwd: 0 });
  }
  *wait(t) {
    let e = 0;
    while (e < t) e += yield;
  }

  wantsFood() {
    const e = this.env;
    return e.offering && e.food && e.food.bitesLeft > 0 && e.foodPoint;
  }

  foodLocal(out) {
    return this.group.worldToLocal(out.copy(this.env.foodPoint));
  }

  canReach() {
    if (!this.wantsFood()) return false;
    const l = this.foodLocal(_v2);
    const dx = l.x - this.neckBaseL.x, dy = l.y - this.neckBaseL.y, dz = l.z - this.neckBaseL.z;
    const d = Math.hypot(dx, dy, dz);
    const ang = Math.atan2(l.x, l.z - 0.2);
    return d < 0.66 && d > 0.22 && l.z > 0.36 && Math.abs(ang) < 0.75 && l.y > 0.3 && l.y < 1.34;
  }

  *taskBite() {
    const food = this.env.food;
    const prof = food.type.profile;
    this.mode = 'reach';
    this.excitement = 1;
    let t = 0;
    let sniffed = false;
    const target = new THREE.Vector3();
    const faceDir = () => {
      const neck = this.group.localToWorld(_v3.copy(this.neckBaseL));
      return _v.subVectors(this.env.foodPoint, neck).normalize().lerp(new THREE.Vector3(0, -1, 0), 0.35).normalize();
    };
    // 1. approach, nose first
    while (t < 2.2) {
      const dt = yield;
      t += dt;
      if (!this.wantsFood() || this.env.food !== food) return this.endReach();
      this.reachFace.copy(faceDir());
      target.copy(this.env.foodPoint).addScaledVector(this.reachFace, -0.05);
      this.reachTarget.copy(target);
      const d = this.mouthWorld.distanceTo(this.env.foodPoint);
      if (d < 0.12 && !sniffed) {
        sniffed = true;
        this.sniffing = 0.45;
        this.audio.sniff(3);
      }
      if (sniffed && this.sniffing <= 0 && d < 0.08) break;
    }
    // 2. open the mouth, push the prehensile upper lip forward, tongue ready
    t = 0;
    while (t < 0.7) {
      const dt = yield;
      t += dt;
      if (!this.wantsFood() || this.env.food !== food) return this.endReach();
      this.jawT.open = 0.24;
      this.lipT.upper = -0.35;
      this.lipT.lower = 0.22;
      this.tongueT.out = 0.008;
      this.reachFace.copy(faceDir());
      this.reachTarget.copy(this.env.foodPoint).addScaledVector(this.reachFace, 0.012);
      if (t > 0.22 && this.mouthWorld.distanceTo(this.reachTarget) < 0.018) break;
    }
    // 3. grasp
    this.jawT.open = 0.05;
    this.lipT.upper = -0.05;
    this.lipT.lower = 0;
    this.tongueT.out = 0;
    yield* this.wait(0.13);
    // 4. tear it off: pull back with a twist
    const bite = food.takeBite();
    if (!bite) return this.endReach();
    this.audio.bite(prof.bite);
    const back = this.reachFace.clone().multiplyScalar(-1);
    const startT = this.reachTarget.clone();
    const twist = Math.random() < 0.5 ? 1 : -1;
    t = 0;
    while (t < 0.35) {
      const dt = yield;
      t += dt;
      const k = smooth(0, 0.3, t);
      this.reachTarget.copy(startT).addScaledVector(back, 0.09 * k).add(_v.set(0, 0.02 * k, 0));
      this.headOffT.roll = twist * 0.22 * Math.sin(Math.PI * Math.min(1, t / 0.3));
    }
    this.headOffT.roll = 0;
    this.mode = 'look';
    this.excitement = 0.7;
    this.attachMouthItem(bite.mouthItem);
    this.mouthful = { profile: prof, color: prof.color };
    this.spawnChunks(prof.color);
    yield* this.taskChew(prof, false);
    yield* this.taskSwallow();
    this.mouthful = null;
    this.endReach();
  }

  endReach() {
    this.mode = 'look';
    this.jawT.open = 0;
    this.lipT.upper = this.lipT.lower = 0;
    this.tongueT.out = 0;
    this.task = null;
    this.taskName = 'idle';
  }

  *taskChew(profile, rumination) {
    const n = rumination ? randi(44, 58) : randi(profile.chews[0], profile.chews[1]);
    this.startChewing(profile, n, rumination);
    while (this.chew.active) {
      yield;
    }
  }

  *taskSwallow(quiet = false) {
    this.headOffT.pitch = 0.14;
    this.headOffT.lift = 0.015;
    yield* this.wait(0.25);
    this.jawT.open = 0.04;
    this.audio.swallow();
    this.startBolus(1, 1.1);
    yield* this.wait(0.18);
    this.jawT.open = 0;
    this.headOffT.pitch = 0;
    this.headOffT.lift = 0;
    this.chunks.count = 0;
    this.detachMouthItem();
    yield* this.wait(0.3);
    if (!quiet && Math.random() < 0.65) yield* this.taskLick();
  }

  *taskLick() {
    // tongue sweeps across the lips to clean them
    this.jawT.open = 0.1;
    const side = Math.random() < 0.5 ? 1 : -1;
    let t = 0;
    while (t < 0.75) {
      const dt = yield;
      t += dt;
      const k = Math.sin(Math.PI * Math.min(1, t / 0.75));
      this.tongueT.out = 0.03 * k;
      this.tongueT.lift = 0.3 * k;
      this.tongueT.side = side * Math.sin(t * 9) * 0.5 * k;
    }
    this.tongueT.out = 0;
    this.tongueT.lift = 0;
    this.tongueT.side = 0;
    this.jawT.open = 0;
    this.audio.lipSmack(0.05);
  }

  *taskRuminate() {
    this.ruminating = true;
    const cud = { chews: [44, 58], hardness: 0.2, wetness: 0.9, fibre: 0.3, color: 0x7d7b45, crumbs: 0 };
    for (let cycle = 0; cycle < 5; cycle++) {
      // regurgitation: the cud comes UP the left side of the neck
      this.headOffT.pitch = -0.08;
      this.headOffT.fwd = 0.02;
      yield* this.wait(0.3);
      this.audio.regurgitate();
      this.startBolus(-1, 0.75);
      yield* this.wait(0.55);
      this.jawT.open = 0.08;
      yield* this.wait(0.12);
      this.jawT.open = 0;
      this.headOffT.pitch = 0;
      this.headOffT.fwd = 0;
      // squeeze the liquid out and swallow it, then chew the cud
      yield* this.wait(0.5);
      this.audio.swallow();
      yield* this.wait(0.6);
      this.mouthful = { profile: cud, color: cud.color };
      this.spawnChunks(cud.color, 6);
      yield* this.taskChew(cud, true);
      yield* this.taskSwallow(true);
      this.mouthful = null;
      yield* this.wait(rand(2.5, 4.5));
      if (Math.random() < 0.4) this.audio.rumen(0.8);
    }
    this.ruminating = false;
    this.idleTime = -30;
    this.task = null;
    this.taskName = 'idle';
  }

  *taskBleat(begging = false) {
    const b = this.audio.bleat({ pitch: begging ? 1.08 : 1, length: begging ? 1.15 : 1 });
    const dur = b.duration;
    this.headOffT.pitch = 0.32;
    this.headOffT.lift = 0.03;
    this.earState.forEach((e) => (e.raise = -0.3));
    let t = -0.05;
    while (t < dur + 0.1) {
      const dt = yield;
      t += dt;
      const env = smooth(0, 0.08, t) * (1 - smooth(dur - 0.15, dur, t));
      const flutter = 0.5 + 0.5 * Math.sin(2 * Math.PI * b.pulse * t);
      this.jawT.open = env * (0.2 + 0.08 * flutter);
      this.jawImmediate = true;
      this.lipT.upper = -0.25 * env;
      this.lipT.lower = 0.35 * env;
      this.tongueT.out = -0.006 * env;
    }
    this.jawImmediate = false;
    this.jawT.open = 0;
    this.lipT.upper = this.lipT.lower = 0;
    this.tongueT.out = 0;
    this.headOffT.pitch = 0;
    this.headOffT.lift = 0;
    this.earState.forEach((e) => (e.raise = 0));
    this.nextBleat = rand(18, 45);
    this.task = null;
    this.taskName = 'idle';
  }

  // ------------------------------------------------------------- chewing
  startChewing(profile, n, rumination) {
    const c = this.chew;
    c.active = true;
    c.profile = profile;
    c.rumination = rumination;
    c.total = n;
    c.count = 0;
    c.phase = 0.6;
    c.lastPhase = 0.6;
    c.side = Math.random() < 0.5 ? 1 : -1;
    c.sideLeft = randi(8, 18);
    c.rate = rumination ? rand(1.08, 1.18) : rand(1.38, 1.6);
    c.amp = rumination ? 0.075 : 0.085 + 0.035 * profile.hardness;
  }
  stopChewing() {
    this.chew.active = false;
  }

  updateChew(dt) {
    const c = this.chew;
    if (!c.active) {
      this.cheekPulse = damp(this.cheekPulse || 0, 0, 8, dt);
      return;
    }
    const prog = c.count / c.total;
    // ingestive chewing is irregular; rumination metronomic
    const jitter = c.rumination ? 0.02 : 0.12;
    const rate = c.rate * (1 + jitter * Math.sin(this.time * 1.7) + (c.rumination ? 0 : 0.08 * (1 - prog)));
    c.phase += dt * rate;
    const amp = c.amp * (c.rumination ? 1 : 1.15 - 0.45 * prog) * (1 + (c.rumination ? 0.02 : 0.1) * Math.sin(this.time * 3.1));
    const p = c.phase % 1;
    // crunch at the start of the power stroke
    if (c.lastPhase % 1 < 0.6 && p >= 0.6) {
      this.audio.chew({
        hardness: c.profile.hardness, wetness: c.profile.wetness, fibre: c.profile.fibre,
        progress: prog, side: c.side, rumination: c.rumination, energy: 1,
      });
      this.onPowerStroke(prog);
    }
    if (c.lastPhase % 1 > 0.9 && p < 0.1) {
      c.count++;
      this.totalChews++;
      this.chewLog.push(this.time);
      c.sideLeft--;
      if (c.sideLeft <= 0) {
        c.side = -c.side;
        c.sideLeft = randi(8, 18);
      }
      if (c.count >= c.total) {
        c.active = false;
        this.jawT.open = 0;
        this.jawT.lat = 0;
        return;
      }
    }
    c.lastPhase = c.phase;
    this.jawT.open = amp * openCurve(p);
    this.jawT.lat = c.side * latCurve(p);
    this.jawT.roll = c.side * 0.5 * (p > 0.5 ? 1 : 0.3);
    this.jawT.prot = (p > 0.6 ? -1 : 1) * 0.001;
    this.jawImmediate = true;
    // masseter bulges on the working side while the teeth are loaded
    this.cheekPulse = smooth(0.42, 0.62, p) * (1 - smooth(0.85, 1, p));
    // the upper lip twitches with the grinding, tongue pushes the bolus back
    this.lipT.upperSide = c.side * 0.08 * Math.sin(p * Math.PI * 2);
    this.tongueT.side = -c.side * 0.12 * openCurve(p);
    this.tongueT.lift = 0.08 * openCurve(p);
  }

  onPowerStroke(prog) {
    const m = this.mouthful;
    if (!m) return;
    // food particles shuffle on the molar table
    this.shuffleChunks(prog);
    // crumbs falling out of the mouth for crunchy food early on
    const pr = (m.profile.crumbs || 0) * (1 - prog) * 0.9;
    if (Math.random() < pr) this.spawnCrumb(m.color);
    if (this.mouthItem) this.mouthItem.userData.progress = Math.min(1, prog * 1.25);
  }

  spawnChunks(color, n = 12) {
    this.chunkMat.color.setHex(color);
    this.chunks.count = n;
    this.shuffleChunks(0);
  }
  shuffleChunks(prog) {
    const side = this.chew.side || 1;
    const n = Math.max(3, Math.round(this.chunks.count));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < this.chunks.count; i++) {
      const sd = this.chunkSeeds[i];
      sd[3] = Math.random();
      const onSide = i < n * 0.7 ? side : -side * 0.3;
      const p = new THREE.Vector3(
        onSide * (0.008 + sd[0] * 0.01),
        MOUTH_Y - 0.0005 + sd[1] * 0.002,
        0.09 + ((sd[2] + sd[3] * 0.2) % 1) * 0.11
      ).sub(JAW_LOCAL);
      q.setFromEuler(new THREE.Euler(sd[3] * 6, sd[0] * 6, sd[1] * 6));
      const sc = 1.25 - 0.85 * prog;
      s.setScalar(sc * (0.6 + sd[1] * 0.8));
      m.compose(p, q, s);
      this.chunks.setMatrixAt(i, m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;
  }

  spawnCrumb(color) {
    const c = this.crumbData[this.crumbCursor];
    this.crumbCursor = (this.crumbCursor + 1) % this.crumbData.length;
    c.alive = true;
    c.life = 0;
    this.b.head.localToWorld(c.p.set(rand(-0.012, 0.012), MOUTH_Y - 0.004, 0.235));
    c.v.set(rand(-0.15, 0.15), rand(-0.1, 0.12), rand(-0.05, 0.2)).applyQuaternion(this.group.quaternion);
    c.color.setHex(color);
    this.crumbs.setColorAt(this.crumbData.indexOf(c), c.color);
    if (this.crumbs.instanceColor) this.crumbs.instanceColor.needsUpdate = true;
  }

  updateCrumbs(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let any = false;
    this.crumbData.forEach((c, i) => {
      if (!c.alive) return;
      any = true;
      c.life += dt;
      if (c.p.y > 0.003) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.rot.x += dt * 9;
        c.rot.y += dt * 7;
        if (c.p.y < 0.003) {
          c.p.y = 0.003;
          c.v.set(0, 0, 0);
        }
      }
      if (c.life > 9) {
        c.alive = false;
        this.crumbs.setMatrixAt(i, zero);
        return;
      }
      q.setFromEuler(c.rot);
      s.setScalar(c.life > 8 ? 9 - c.life : 1);
      m.compose(c.p, q, s);
      this.crumbs.setMatrixAt(i, m);
    });
    if (any) this.crumbs.instanceMatrix.needsUpdate = true;
  }

  attachMouthItem(item) {
    this.detachMouthItem();
    if (!item) return;
    const pivot = new THREE.Group();
    pivot.position.set(0, MOUTH_Y, 0.2).sub(JAW_LOCAL);
    item.position.set(0, -MOUTH_Y, -0.2);
    pivot.add(item);
    pivot.userData = { progress: 0, item };
    item.userData.progress = 0;
    const base = new THREE.Group();
    base.rotation.x = JAW_BIND_OPEN;
    base.add(pivot);
    this.b.jaw.add(base);
    this.mouthBase = base;
    this.mouthItem = item;
    this.mouthPivot = pivot;
  }
  detachMouthItem() {
    if (this.mouthPivot) {
      this.b.jaw.remove(this.mouthBase);
      this.mouthPivot = null;
      this.mouthItem = null;
    }
  }

  startBolus(dir, dur) {
    Object.assign(this.bolus, { active: true, s: 0, dir, dur, t: 0 });
  }

  // ------------------------------------------------------------- brain
  think(dt) {
    const e = this.env;
    const wants = this.wantsFood();
    if (this.task && this.taskName === 'ruminate' && wants) {
      // goats will happily interrupt cud-chewing for a treat
      this.abortTask();
      this.bolus.active = false;
      this.chunks.count = 0;
    }
    if (this.task) return;

    if (wants) {
      this.idleTime = 0;
      if (this.canReach() && this.gaitAmt < 0.3) {
        this.walkTarget = null;
        this.startTask('bite', this.taskBite());
        return;
      }
      // walk over to the food
      const f = _v2.copy(e.foodPoint);
      f.y = 0;
      const p = _v3.copy(e.playerPos);
      p.y = 0;
      const u = _v.copy(this.pos).sub(p);
      u.y = 0;
      if (u.lengthSq() < 1e-4) u.set(0, 0, 1);
      u.normalize();
      const tgt = f.clone().addScaledVector(u, 0.78);
      if (tgt.length() > 6.3) tgt.setLength(6.3);
      this.walkTarget = { pos: tgt, face: e.foodPoint.clone() };
      this.excitement = Math.max(this.excitement, 0.6);
      return;
    }
    this.idleTime += dt;
    this.excitement = damp(this.excitement, 0, 0.3, dt);

    // curious: follow the player who is holding food (but not offering)
    if (e.holdingFood && e.playerPos) {
      const d = Math.hypot(e.playerPos.x - this.pos.x, e.playerPos.z - this.pos.z);
      if (d > 2.2 && !this.walkTarget && Math.random() < dt * 0.35) {
        const p = e.playerPos.clone();
        p.y = 0;
        const dir = this.pos.clone().sub(p).setY(0).normalize();
        this.walkTarget = { pos: p.addScaledVector(dir, 1.3), face: e.playerPos.clone() };
      }
      this.nextBleat -= dt * (d < 3 ? 1.6 : 0.5);
    } else {
      this.nextBleat -= dt;
    }
    if (this.nextBleat <= 0 && !this.walkTarget) {
      this.startTask('bleat', this.taskBleat(e.holdingFood));
      return;
    }
    if (this.idleTime > 22 && !this.walkTarget) {
      this.idleTime = 0;
      this.startTask('ruminate', this.taskRuminate());
      return;
    }
  }

  forceRuminate() {
    if (this.taskName === 'ruminate') return;
    this.abortTask();
    this.startTask('ruminate', this.taskRuminate());
  }
  forceBleat() {
    if (this.task) return;
    this.startTask('bleat', this.taskBleat(false));
  }

  // ------------------------------------------------------------- locomotion
  updateLocomotion(dt) {
    let targetSpeed = 0, turn = 0;
    if (this.walkTarget) {
      const to = _v.copy(this.walkTarget.pos).sub(this.pos);
      to.y = 0;
      const dist = to.length();
      let desiredYaw;
      if (dist > 0.12) desiredYaw = Math.atan2(to.x, to.z);
      else {
        const f = _v2.copy(this.walkTarget.face).sub(this.pos);
        desiredYaw = Math.atan2(f.x, f.z);
      }
      const err = wrapAngle(desiredYaw - this.yaw);
      turn = Math.max(-1.6, Math.min(1.6, err * 3));
      if (dist > 0.12 && Math.abs(err) < 1.1) targetSpeed = Math.min(0.62, dist * 1.4 + 0.1) * (1 - Math.abs(err) / 1.4);
      if (dist <= 0.12 && Math.abs(err) < 0.06) this.walkTarget = null;
    }
    this.speed = damp(this.speed, targetSpeed, 4, dt);
    this.turnVel = damp(this.turnVel, turn, 6, dt);
    this.yaw += this.turnVel * dt;
    const fwd = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(fwd, this.speed * dt);
    // keep inside the paddock and off the player
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 6.6) this.pos.multiplyScalar(6.6 / r);
    if (this.env.playerPos) {
      const pp = this.env.playerPos;
      const c = _v2.set(Math.sin(this.yaw) * 0.25, 0, Math.cos(this.yaw) * 0.25).add(this.pos); // chest
      const dx = c.x - pp.x, dz = c.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4) {
        this.pos.x += (dx / d) * (0.62 - d);
        this.pos.z += (dz / d) * (0.62 - d);
      }
    }
    this.group.rotation.y = this.yaw;
    const moving = this.speed > 0.03 || Math.abs(this.turnVel) > 0.15;
    this.gaitAmt = damp(this.gaitAmt, moving ? 1 : 0, 5, dt);
    this.gait += dt * (this.speed / 0.4 + Math.abs(this.turnVel) * 0.45 + (moving ? 0.25 : 0));
  }

  applyGait() {
    const a = this.gaitAmt;
    if (a < 0.01) return;
    const b = this.b;
    const stride = Math.min(1, this.speed / 0.5 + Math.abs(this.turnVel) * 0.3 + 0.25);
    // lateral-sequence walk: LH, LF, RH, RF
    const legs = [
      ['femurL', 'tibiaL', 'hockL', 'fetlockHL', 0.0, true],
      ['humerusL', 'radiusL', 'carpusL', 'fetlockFL', 0.25, false],
      ['femurR', 'tibiaR', 'hockR', 'fetlockHR', 0.5, true],
      ['humerusR', 'radiusR', 'carpusR', 'fetlockFR', 0.75, false],
    ];
    for (const [up, mid, low, fet, off, hind] of legs) {
      const ph = (this.gait + off) % 1;
      const swing = ph < 0.35;
      const s = swing ? -Math.cos((ph / 0.35) * Math.PI) : Math.cos(((ph - 0.35) / 0.65) * Math.PI);
      const lift = swing ? Math.sin((ph / 0.35) * Math.PI) : 0;
      const A = 0.28 * stride * a;
      rotX(b[up], -s * A * (hind ? 0.8 : 1));
      if (hind) {
        rotX(b[mid], lift * 0.45 * a);
        rotX(b[low], -lift * 0.75 * a);
        rotX(b[fet], lift * 0.5 * a);
      } else {
        rotX(b[mid], lift * 0.15 * a);
        rotX(b[low], lift * 1.1 * a);
        rotX(b[fet], lift * 0.5 * a);
      }
    }
    // body roll / bob
    rotZ(b.pelvis, Math.sin(this.gait * Math.PI * 2) * 0.025 * a);
    b.pelvis.position.y += Math.abs(Math.sin(this.gait * Math.PI * 2)) * 0.006 * a;
  }

  // ------------------------------------------------------------- pose
  resetPose() {
    for (const [n, bone] of Object.entries(this.b)) {
      const r = this.restBone[n];
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
  }

  computeHeadGoals(dt) {
    const off = this.headOff;
    for (const k in off) off[k] = damp(off[k], this.headOffT[k], 7, dt);
    let mouthW, faceW;
    if (this.mode === 'reach') {
      mouthW = _v.copy(this.reachTarget);
      faceW = _v2.copy(this.reachFace);
    } else {
      // look at something: the head swings about the neck base
      const L = this.group.worldToLocal(_v3.copy(this.lookTarget));
      const d = L.clone().sub(this.neckBaseL);
      let yaw = Math.atan2(d.x, d.z);
      yaw = Math.max(-1.3, Math.min(1.3, yaw));
      const elev = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const pitchUp = Math.max(-0.5, Math.min(0.5, elev * 0.55)) + off.pitch;
      const mouth = this.restMouthL.clone().sub(this.neckBaseL);
      mouth.applyAxisAngle(UP, yaw * 0.7 + off.yaw);
      mouth.add(this.neckBaseL);
      mouth.y += pitchUp * 0.09 + off.lift;
      mouth.addScaledVector(_v4.set(Math.sin(yaw * 0.7), 0, Math.cos(yaw * 0.7)), off.fwd + pitchUp * 0.03);
      const face = this.restFaceL.clone();
      face.applyAxisAngle(new THREE.Vector3(1, 0, 0), -pitchUp);
      face.applyAxisAngle(UP, yaw * 0.95 + off.yaw);
      mouthW = this.group.localToWorld(mouth);
      faceW = face.transformDirection(this.group.matrixWorld);
    }
    this.mouthS.update(mouthW, dt, this.mode === 'reach' ? 9 : 5);
    this.faceS.update(faceW, dt, this.mode === 'reach' ? 9 : 5);
  }

  solveNeck() {
    const b = this.b;
    const head = b.head;
    const face = _v.copy(this.faceS.v).normalize();
    // head orientation: +Z = face, +Y as close to world up as possible, plus roll
    const y = _v2.copy(UP).addScaledVector(face, -face.dot(UP)).normalize();
    const x = _v3.crossVectors(y, face);
    const qHead = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, face));
    if (Math.abs(this.headOff.roll) > 1e-4) qHead.premultiply(_q3.setFromAxisAngle(face, this.headOff.roll));
    const setHead = () => {
      head.parent.getWorldQuaternion(_q2).invert();
      head.quaternion.copy(_q2).multiply(qHead);
      head.updateMatrixWorld(true);
    };
    const chain = [b.neck2, b.neck1, b.neck0, b.spine2];
    const gain = [0.5, 0.45, 0.4, 0.12];
    const limit = [0.75, 0.6, 0.6, 0.12];
    const goal = this.mouthS.v;
    this.group.updateMatrixWorld(true);
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < chain.length; i++) {
        const bone = chain[i];
        setHead();
        const eff = head.localToWorld(_v4.copy(LIPS_LOCAL));
        const bp = bone.getWorldPosition(new THREE.Vector3());
        const a = eff.sub(bp).normalize();
        const c = goal.clone().sub(bp).normalize();
        const qw = _q.setFromUnitVectors(a, c);
        // partial step
        qw.slerp(_q3.identity(), 1 - gain[i]);
        // world delta -> local
        bone.parent.getWorldQuaternion(_q2);
        const pInv = _q2.clone().invert();
        const local = pInv.multiply(qw).multiply(_q2).multiply(bone.quaternion);
        bone.quaternion.copy(local);
        // clamp relative to rest
        const rest = this.restBone[bone.name].q;
        const delta = _q2.copy(rest).invert().multiply(bone.quaternion);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
        if (ang > limit[i]) {
          delta.slerp(_q3.identity(), 1 - limit[i] / ang);
          bone.quaternion.copy(rest).multiply(delta);
        }
        bone.updateMatrixWorld(true);
      }
    }
    setHead();
    // limit head relative to neck
    const restH = this.restBone.head.q;
    const dH = _q2.copy(restH).invert().multiply(head.quaternion);
    const angH = 2 * Math.acos(Math.min(1, Math.abs(dH.w)));
    if (angH > 1.1) {
      dH.slerp(_q3.identity(), 1 - 1.1 / angH);
      head.quaternion.copy(restH).multiply(dH);
      head.updateMatrixWorld(true);
    }
  }

  applyMouth(dt) {
    const b = this.b;
    const J = this.jaw, T = this.jawT;
    const k = this.jawImmediate ? 40 : 14;
    for (const key in J) J[key] = damp(J[key], T[key], k, dt);
    _e.set(J.open - JAW_BIND_OPEN, J.lat * 0.045, J.lat * 0.025 + J.roll * 0.02, 'YXZ');
    b.jaw.quaternion.copy(this.restBone.jaw.q).multiply(_q.setFromEuler(_e));
    b.jaw.position.copy(this.restBone.jaw.p);
    b.jaw.position.x += J.lat * 0.0022;
    b.jaw.position.z += J.prot;

    const L = this.lip, LT = this.lipT;
    for (const key in L) L[key] = damp(L[key], LT[key], 12, dt);
    _e.set(L.upper, L.upperSide, 0);
    b.upperLip.quaternion.copy(this.restBone.upperLip.q).multiply(_q.setFromEuler(_e));
    b.upperLip.position.copy(this.restBone.upperLip.p);
    b.upperLip.position.z += -L.upper * 0.012;
    _e.set(L.lower, 0, 0);
    b.lowerLip.quaternion.copy(this.restBone.lowerLip.q).multiply(_q.setFromEuler(_e));

    const Tg = this.tongue, TT = this.tongueT;
    for (const key in Tg) Tg[key] = damp(Tg[key], TT[key], 12, dt);
    b.tongue0.position.copy(this.restBone.tongue0.p);
    b.tongue0.position.z += Tg.out;
    b.tongue0.position.y += Tg.lift * 0.004;
    for (const [n, w] of [['tongue1', 0.4], ['tongue2', 0.7], ['tongue3', 1]]) {
      _e.set(-Tg.lift * w * 0.6 + Tg.curl * w, Tg.side * w, 0);
      b[n].quaternion.copy(this.restBone[n].q).multiply(_q.setFromEuler(_e));
    }

    // mouth item (hay strands / leaf) is drawn in as chewing progresses
    if (this.mouthPivot) {
      const pr = this.mouthItem.userData.progress || 0;
      const sc = Math.max(0.001, 1 - pr);
      this.mouthPivot.scale.set(1, 1, sc);
      this.mouthPivot.rotation.y = Math.sin(this.time * 9) * 0.06 * sc + this.jaw.lat * 0.1;
      this.mouthPivot.rotation.x = 0.05 * Math.sin(this.time * 6.3);
      this.mouthPivot.visible = pr < 0.98;
    }
  }

  applyFace(dt) {
    const g = this.g;
    // blink
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      this.blinkTimer = rand(2.5, 7);
    }
    let lid = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.2;
      lid = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      if (this.blinkPhase >= 1) this.blinkPhase = -1;
    }
    const relaxed = this.ruminating ? 0.35 : 0; // drowsy lids while ruminating
    const close = Math.max(lid, relaxed);
    const look = this.lookTarget;
    for (const e of g.eyes) {
      e.upper.rotation.x = -0.08 + close * 0.92;
      e.lower.rotation.x = -close * 0.25;
      // gaze toward the look target, pupils kept horizontal (they counter-roll)
      e.pivot.updateMatrixWorld(true);
      const eyePos = e.pivot.getWorldPosition(_v);
      const baseDir = _v2.set(0, 0, 1).transformDirection(e.pivot.matrixWorld);
      const want = _v3.copy(look).sub(eyePos).normalize();
      const ang = baseDir.angleTo(want);
      const lim = 0.45;
      if (ang > lim) want.copy(baseDir).lerp(want, lim / ang).normalize();
      let xw = _v4.crossVectors(UP, want);
      if (xw.lengthSq() < 1e-4) xw.set(1, 0, 0);
      xw.normalize();
      const yw = new THREE.Vector3().crossVectors(want, xw);
      const qw = _q.setFromRotationMatrix(_m.makeBasis(xw, yw, want));
      e.pivot.getWorldQuaternion(_q2).invert();
      e.eye.quaternion.copy(_q2.multiply(qw));
    }
    // ears: attentive toward the player, flicks, twitch with chewing (temporalis)
    const chewTwitch = this.chew.active ? Math.max(0, Math.sin(this.chew.phase * Math.PI * 2)) * 0.06 : 0;
    g.ears.forEach((ear, i) => {
      const st = this.earState[i];
      st.flickT -= dt;
      if (st.flickT <= 0) {
        st.flick = 1;
        st.flickT = rand(2.5, 9);
      }
      st.flick = Math.max(0, st.flick - dt * 5);
      const fl = Math.sin(st.flick * Math.PI) * 0.5;
      const swivel = (this.excitement * 0.35 - 0.05) + Math.sin(this.time * 0.37 + i * 2) * 0.08;
      _e.set(fl * 0.5 + st.raise * 0.6, ear.side * (swivel + fl * 0.4), ear.side * (-st.raise - chewTwitch - 0.05 * Math.sin(this.time * 0.5 + i)));
      ear.bone.quaternion.copy(this.restBone[ear.bone.name].q).multiply(_q.setFromEuler(_e));
    });
    // tail
    this.tailWag = damp(this.tailWag, this.excitement > 0.5 ? 1 : 0, 3, dt);
    const tw = Math.sin(this.time * 15) * 0.45 * this.tailWag + Math.sin(this.time * 0.8) * 0.05;
    _e.set(-0.1 * this.tailWag, tw, 0);
    this.b.tail.quaternion.copy(this.restBone.tail.q).multiply(_q.setFromEuler(_e));
  }

  applySecondary(dt) {
    // wattles and beard swing from head acceleration
    const hp = this.b.head.getWorldPosition(_v);
    const vel = _v2.copy(hp).sub(this.prevHeadPos).divideScalar(Math.max(dt, 1e-3));
    this.headAcc.copy(vel).sub(this.prevHeadVel).divideScalar(Math.max(dt, 1e-3));
    this.prevHeadPos.copy(hp);
    this.prevHeadVel.copy(vel);
    const acc = this.headAcc.clampLength(0, 30);
    const local = acc.clone().applyQuaternion(this.group.quaternion.clone().invert());
    for (const w of this.g.wattles) {
      w.vel.x += (-local.z * 0.02 - w.ang.x * 60 - w.vel.x * 5) * dt;
      w.vel.y += (local.x * 0.02 - w.ang.y * 60 - w.vel.y * 5) * dt;
      w.ang.addScaledVector(w.vel, dt);
      w.pivot.quaternion.copy(w.restQ).multiply(_q.setFromEuler(_e.set(w.ang.x, 0, w.ang.y)));
    }
    const jawKick = (this.jaw.open - (this.prevJaw || 0)) / Math.max(dt, 1e-3);
    this.prevJaw = this.jaw.open;
    this.beardVel.x += (-local.z * 0.012 + jawKick * 0.05 - this.beardAng.x * 50 - this.beardVel.x * 4) * dt;
    this.beardVel.y += (local.x * 0.012 + this.jaw.lat * 0.4 - this.beardAng.y * 50 - this.beardVel.y * 4) * dt;
    this.beardAng.addScaledVector(this.beardVel, dt);
    this.g.beardPivot.rotation.set(this.beardAng.x, 0, this.beardAng.y);
  }

  applyUniforms(dt) {
    const u = this.g.uniforms;
    // breathing (faster when excited)
    const rate = this.breathRate * (1 + this.excitement * 0.8);
    this.breathPhase += dt * rate;
    const br = Math.sin(this.breathPhase * Math.PI * 2);
    u.uBreath.value = 0.0028 * br;
    // nostrils flare on inhale, flutter while sniffing
    if (this.sniffing > 0) this.sniffing -= dt;
    const sniff = this.sniffing > 0 ? 0.5 + 0.5 * Math.sin(this.time * 48) : 0;
    u.uNostril.value = Math.max(0, br) * 0.5 + sniff;
    this.audio.setBreath(this.sniffing > 0 ? 0 : (0.35 + 0.65 * Math.max(0, br)) * (1 + this.excitement), br > 0);
    // masseter bulge on the working side
    const cp = this.cheekPulse || 0;
    const side = this.chew.side;
    u.uCheek.value.set(side > 0 ? cp : cp * 0.25, side < 0 ? cp : cp * 0.25);
    // bolus travelling in the esophagus
    const bo = this.bolus;
    if (bo.active) {
      bo.t += dt;
      const s = Math.min(1, bo.t / bo.dur);
      const pathS = bo.dir > 0 ? s : 1 - s;
      const p = this.esoCurve.getPointAt(Math.min(0.999, Math.max(0, pathS)));
      const env = Math.sin(Math.PI * s);
      u.uBolus.value.set(p.x, p.y, p.z, 0.011 * Math.pow(env, 0.5));
      if (s >= 1) {
        bo.active = false;
        u.uBolus.value.w = 0;
      }
    }
  }

  recordJaw() {
    // lower incisor tip relative to the closed rest position (head frame)
    const J = this.jaw;
    _e.set(J.open, J.lat * 0.045, J.lat * 0.025 + J.roll * 0.02, 'YXZ');
    const p = _v.copy(INCISOR_LOCAL).sub(JAW_LOCAL).applyQuaternion(_q.setFromEuler(_e));
    p.add(JAW_LOCAL).sub(INCISOR_LOCAL);
    p.x += J.lat * 0.0022;
    this.jawTrace.push({ t: this.time, x: p.x, y: p.y });
    while (this.jawTrace.length && this.time - this.jawTrace[0].t > 2.6) this.jawTrace.shift();
  }

  // ------------------------------------------------------------- main
  update(dt, env) {
    this.env = env;
    this.time += dt;
    this.think(dt);
    if (this.task) {
      const r = this.task.next(dt);
      if (r.done && this.task) {
        this.task = null;
        this.taskName = 'idle';
      }
    }
    this.updateLocomotion(dt);
    this.updateChew(dt);

    // where to look
    if (this.debugLook) this.lookTarget.copy(this.debugLook);
    else if (this.mode === 'look') {
      this.nextLook -= dt;
      const pl = env.playerHead;
      if (this.taskName === 'ruminate') {
        // relaxed, looking ahead and slightly down
        this.lookTarget.lerp(this.group.localToWorld(_v.set(0.2 * Math.sin(this.time * 0.1), 0.55, 2.2)), 1 - Math.exp(-dt));
      } else if (this.walkTarget && env.offering && env.foodPoint) {
        this.lookTarget.copy(env.foodPoint);
      } else if (pl && (pl.distanceTo(this.pos) < 7 || env.holdingFood)) {
        if (this.nextLook <= 0) {
          this.nextLook = rand(2, 5);
          this.lookWander.set(rand(-1.5, 1.5), rand(-0.9, 0.3), rand(-1.5, 1.5));
          if (Math.random() < 0.75) this.lookWander.multiplyScalar(0.05);
        }
        const t = _v.copy(pl).add(this.lookWander);
        if (env.holdingFood && env.handPos) t.lerp(env.handPos, 0.5);
        this.lookTarget.lerp(t, 1 - Math.exp(-dt * 4));
      }
    }

    this.resetPose();
    this.applyGait();
    // chewing makes the head bob a little; the jaw drags the skull
    if (this.chew.active) {
      const p = this.chew.phase % 1;
      this.headOffT.pitch = (this.headOffT.pitch || 0) * 0.9 + 0.012 * openCurve(p);
    }
    this.computeHeadGoals(dt);
    this.solveNeck();
    this.applyMouth(dt);
    this.applyFace(dt);
    this.applySecondary(dt);
    this.applyUniforms(dt);
    this.updateCrumbs(dt);
    this.recordJaw();
    this.updateStatus();
  }

  chewRatePerMin() {
    const now = this.time;
    while (this.chewLog.length && now - this.chewLog[0] > 10) this.chewLog.shift();
    if (this.chewLog.length < 3) return 0;
    const span = this.chewLog[this.chewLog.length - 1] - this.chewLog[0];
    return span > 0 ? ((this.chewLog.length - 1) / span) * 60 : 0;
  }

  updateStatus() {
    const c = this.chew;
    const side = c.side > 0 ? '左' : '右';
    let main = 'ゆき：こちらを見ている', sub = '';
    switch (this.taskName) {
      case 'bite':
        main = this.mode === 'reach' ? 'ゆき：餌に口を伸ばしている' : 'ゆき：もぐもぐ咀嚼中';
        break;
      case 'ruminate':
        main = 'ゆき：反芻中（反すう）';
        break;
      case 'bleat':
        main = 'ゆき：メェ〜と鳴いている';
        break;
    }
    if (this.walkTarget && this.taskName === 'idle') main = 'ゆき：近づいてくる';
    if (c.active) {
      sub = `咀嚼 ${c.count}/${c.total} 回　${side}側の臼歯ですりつぶし中\n` +
        `咀嚼リズム ${Math.round(this.chewRatePerMin()) || '--'} 回/分　${c.rumination ? '（反芻：ゆっくり規則的）' : '（採食：やや速く不規則）'}`;
    } else if (this.bolus.active) {
      sub = this.bolus.dir > 0 ? '飲み込んだ！ 首の左側を食塊が下っていく' : '食塊が首の左側を上がってくる（吐き戻し）';
    } else if (this.taskName === 'idle') {
      sub = this.env.holdingFood ? '左クリック長押しで餌を差し出そう' : '';
    }
    sub += `\n累計咀嚼 ${this.totalChews} 回`;
    this.status.main = main;
    this.status.sub = sub;
  }
}

function rotX(bone, a) {
  bone.quaternion.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), a));
}
function rotZ(bone, a) {
  bone.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), a));
}
