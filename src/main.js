// Treat n Treat — goat feeding & observation demo (Three.js / WebGL)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld } from './world.js';
import { buildGoat } from './goat/GoatBuilder.js';
import { GoatController } from './goat/GoatController.js';
import { runJobsParallel, toGeometry } from './jobs.js';
import { GoatAudio } from './audio/GoatAudio.js';
import { Player } from './player.js';
import { createFoods, FOOD_TYPES } from './food.js';
import { HUD } from './ui.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const DEBUG_ORBIT = params.has('orbit');

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !SHOT, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') || 70), innerWidth / innerHeight, 0.015, 500);
scene.add(camera);
const world = createWorld(renderer, scene);

// ------------------------------------------------------------ loading
const loadBar = document.getElementById('load-bar');
const loadStep = document.getElementById('load-step');
const stepNames = { body: '胴体', head: '頭部・口腔', parts: '歯・舌・耳・蹄', hand: '手' };
let done = 0;
const results = await runJobsParallel(['body', 'head', 'parts', 'hand'], (name) => {
  done++;
  loadBar.style.width = `${(done / 4) * 100}%`;
  loadStep.textContent = `${stepNames[name]} 完成`;
});
const [body, head, parts, handRes] = results;

const furShells = params.has('nofur') ? 0 : Number(params.get('fur') || 14);
const goat = buildGoat({ furShells, results: { body, head, parts } });
scene.add(goat.group);

const audio = new GoatAudio();
const ctrl = new GoatController(goat, audio);
scene.add(ctrl.crumbs);
const player = new Player(camera, canvas);
player.onStep = (sp) => audio.footstep(Math.min(1.5, sp));

// ------------------------------------------------------------ hand + food
const handRig = new THREE.Group();
camera.add(handRig);
const hand = new THREE.Group();
hand.rotation.y = Math.PI;
hand.scale.x = -1; // sculpted as a left fist; mirror into the right hand
handRig.add(hand);
const handMesh = new THREE.Mesh(toGeometry(handRes), new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.6, sheen: 0.4, sheenColor: new THREE.Color(1, 0.8, 0.7),
}));
handMesh.castShadow = true;
hand.add(handMesh);
const foods = createFoods();
for (const f of foods) {
  f.root.position.z = -0.022;
  f.root.visible = false;
  hand.add(f.root);
}
let foodIndex = 0;
foods[0].root.visible = true;
let refillTimer = 0;
let tug = 0;
const lastBites = foods.map((f) => f.bitesLeft);

function selectFood(i) {
  foodIndex = (i + foods.length) % foods.length;
  foods.forEach((f, k) => (f.root.visible = k === foodIndex));
  hud.setFood(foodIndex, foods);
}

// ------------------------------------------------------------ HUD / input
const hud = new HUD(foods);
hud.setFood(0, foods);
let timeScale = 1;
let started = false;

const startEl = document.getElementById('start');
document.getElementById('loading').classList.add('hidden');
startEl.classList.remove('hidden');
document.getElementById('start-btn').addEventListener('click', () => {
  audio.init();
  player.lock();
  started = true;
});
canvas.addEventListener('click', () => {
  if (started && !player.locked) player.lock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  startEl.classList.toggle('hidden', locked || DEBUG_ORBIT);
  document.getElementById('hud').classList.toggle('hidden', !started);
  if (locked) audio.init();
});
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= foods.length) selectFood(n - 1);
  }
  if (e.code === 'KeyT') {
    timeScale = timeScale === 1 ? 0.5 : timeScale === 0.5 ? 0.25 : 1;
    hud.setSlowmo(timeScale);
  }
  if (e.code === 'KeyJ') hud.toggleJaw();
  if (e.code === 'KeyR') {
    ctrl.forceRuminate();
    hud.hint('ゆきが反芻を始めた（首の左側に注目）');
  }
  if (e.code === 'KeyB') {
    hud.hint('「ゆき〜！」');
    setTimeout(() => ctrl.forceBleat(), 600);
  }
  if (e.code === 'KeyH' || e.code === 'Escape') {
    if (e.code === 'KeyH') document.exitPointerLock?.();
  }
});
addEventListener('wheel', (e) => {
  if (!player.locked) return;
  selectFood(foodIndex + (e.deltaY > 0 ? 1 : -1));
});

// ------------------------------------------------------------ debug orbit
let orbit = null;
if (DEBUG_ORBIT) {
  orbit = new OrbitControls(camera, canvas);
  const cam = params.get('cam'), look = params.get('look');
  camera.position.fromArray(cam ? cam.split(',').map(Number) : [1.4, 1.2, 1.6]);
  orbit.target.fromArray(look ? look.split(',').map(Number) : [0, 0.8, 0.3]);
  orbit.update();
  document.getElementById('hud').classList.remove('hidden');
}

// ------------------------------------------------------------ loop
const clock = new THREE.Clock();
const tmp = new THREE.Vector3(), mouthPos = new THREE.Vector3(), bodyPos = new THREE.Vector3();
const foodPoint = new THREE.Vector3();
let hudTimer = 0;
let simTime = 0;

function frame(fixedDt, noRender = false) {
  const rdt = fixedDt ?? Math.min(clock.getDelta(), 0.05);
  const dt = rdt * timeScale;
  simTime += rdt;
  const t = simTime;

  const colliders = ctrl.getColliders();
  if (!orbit) player.update(rdt, colliders, world);
  else orbit.update();

  // hand pose: rest at the lower right; when offering, the arm reaches out and
  // down to about goat-head height in front of you
  const o = player.offer;
  tug = Math.max(0, tug - rdt * 4);
  const rest = tmp.set(0.2, -0.27, -0.42);
  const fwdH = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const reach = 0.5 + 0.1 * Math.cos(player.pitch);
  const outW = new THREE.Vector3(player.pos.x, 0, player.pos.z).addScaledVector(fwdH, reach);
  outW.y = THREE.MathUtils.clamp(player.eye - 0.32 + Math.sin(player.pitch) * 0.45, 0.62, 1.18);
  outW.addScaledVector(new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw)), 0.06);
  camera.updateMatrixWorld();
  const out = camera.worldToLocal(outW);
  handRig.position.lerpVectors(rest, out, o);
  handRig.position.z -= tug * 0.03;
  handRig.position.y += Math.sin(t * 1.3) * 0.003;
  // the food points forward-left at rest; when offering it points toward the goat
  const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.35, 0.25));
  const handW = handRig.getWorldPosition(new THREE.Vector3());
  const aim = ctrl.getMouthPosition(new THREE.Vector3()).sub(handW);
  aim.y = Math.min(aim.y, 0.1) * 0.5;
  if (aim.lengthSq() < 1e-4) aim.copy(fwdH);
  aim.normalize().lerp(fwdH, 0.4).normalize();
  // world-space orientation whose -Z is the aim direction
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), aim, new THREE.Vector3(0, 1, 0));
  const offerQ = new THREE.Quaternion().setFromRotationMatrix(m);
  offerQ.premultiply(camera.getWorldQuaternion(new THREE.Quaternion()).invert());
  handRig.quaternion.slerpQuaternions(restQ, offerQ, o);

  const food = foods[foodIndex];
  food.getBitePoint(foodPoint);
  const env = {
    playerPos: player.pos,
    playerHead: camera.position,
    handPos: handRig.getWorldPosition(new THREE.Vector3()),
    offering: o > 0.75 && !orbit,
    holdingFood: food.bitesLeft > 0,
    food,
    foodPoint,
  };
  if (orbit && params.has('feed')) env.offering = true;
  ctrl.update(dt, env);

  // food bookkeeping (bite tug, auto refill)
  foods.forEach((f, i) => {
    if (f.bitesLeft < lastBites[i]) {
      tug = 1;
      hud.setFood(foodIndex, foods);
    }
    lastBites[i] = f.bitesLeft;
  });
  if (food.bitesLeft <= 0) {
    refillTimer += rdt;
    if (refillTimer > 2.5) {
      food.reset();
      lastBites[foodIndex] = food.bitesLeft;
      refillTimer = 0;
      hud.setFood(foodIndex, foods);
      hud.hint(`${food.type.label}を補充しました`);
    }
  } else refillTimer = 0;

  world.update(rdt, t, ctrl.pos.clone().setY(0.5));
  audio.updateListener(camera);
  audio.updateSources(ctrl.getMouthPosition(mouthPos), ctrl.getBodyPosition(bodyPos));

  hudTimer -= rdt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    const d = camera.position.distanceTo(mouthPos);
    hud.setStatus(ctrl.status, `視点：${player.stanceLabel}　口までの距離 ${d.toFixed(2)} m`);
  }
  hud.drawJaw(ctrl);

  if (!noRender) renderer.render(scene, camera);
  if (!SHOT) requestAnimationFrame(() => frame());
}

if (SHOT) {
  // deterministic stepping for headless screenshots
  window.__frames = (n = 1, dt = 1 / 30) => {
    for (let i = 0; i < n; i++) frame(dt, i < n - 1);
  };
}
frame(SHOT ? 1 / 30 : undefined);
window.__app = { goat, ctrl, player, camera, foods, scene, renderer, selectFood };
window.__ready = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
