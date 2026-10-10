// Pasture environment: sky, sun, grass, fence, hay bale, distant trees.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createWorld(renderer, scene, { grass: grassCount = 60000, shadowSize = 2048 } = {}) {
  // sky + sun
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const sun = new THREE.Vector3();
  const elevation = 38, azimuth = 135;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sun.setFromSphericalCoords(1, phi, theta);
  const su = sky.material.uniforms;
  su.turbidity.value = 4;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.8;
  su.sunPosition.value.copy(sun);
  scene.add(sky);

  // image based lighting from the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = sky.clone();
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4a5a2a, side: THREE.BackSide }));
  envScene.add(ground);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.75;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5a35, 0.35);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sunLight.position.copy(sun).multiplyScalar(12);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sunLight.shadow.camera;
  sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 30;
  sunLight.shadow.bias = -0.0003;
  sunLight.shadow.normalBias = 0.015;
  sunLight.shadow.radius = 3;
  scene.add(sunLight);
  scene.add(sunLight.target);

  scene.fog = new THREE.Fog(0xc9d8e6, 25, 140);

  // ground
  const groundTex = makeGroundTexture();
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(60, 60);
  groundTex.anisotropy = 8;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const groundMesh = new THREE.Mesh(
    new THREE.CircleGeometry(150, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const grass = createGrass(grassCount);
  scene.add(grass.mesh);

  // fence ring (paddock, radius 7 m)
  const fence = createFence(7.5);
  scene.add(fence);

  // props
  const bale = createHayBale();
  bale.position.set(-2.6, 0, -2.2);
  bale.rotation.y = 0.5;
  scene.add(bale);

  const trees = createTrees();
  scene.add(trees);

  return {
    sunLight,
    update(dt, t, focus) {
      grass.material.uniforms && (grass.material.userData.uTime.value = t);
      if (focus) {
        sunLight.target.position.copy(focus);
        sunLight.position.copy(focus).addScaledVector(sun, 12);
      }
    },
    bounds: { radius: 7.5 },
    boxes: [{ cx: -2.6, cz: -2.2, hx: 0.5, hz: 0.25, rot: -0.5 }],
  };
}

function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6a34';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const l = 30 + Math.random() * 30;
    g.fillStyle = `hsl(${70 + Math.random() * 25}, ${30 + Math.random() * 25}%, ${l}%)`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 4);
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(110,90,60,${Math.random() * 0.25})`;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 14, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

function createGrass(count) {
  // instanced grass blades with wind sway
  const blade = new THREE.PlaneGeometry(0.012, 0.16, 1, 4);
  blade.translate(0, 0.08, 0);
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - y / 0.17));
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f8a3a, roughness: 0.9, side: THREE.DoubleSide });
  mat.userData.uTime = { value: 0 };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = mat.userData.uTime;
    s.vertexShader = 'uniform float uTime;\nvarying float vH;\n' + s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vH = position.y / 0.16;
       vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
       float sway = sin(uTime * 1.7 + wp.x * 0.8 + wp.z * 0.6) * 0.5 + sin(uTime * 3.1 + wp.x * 2.0) * 0.2;
       transformed.x += sway * 0.04 * vH * vH;
       transformed.z += sway * 0.02 * vH * vH;`
    );
    s.fragmentShader = 'varying float vH;\n' + s.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n diffuseColor.rgb *= mix(0.45, 1.15, vH);'
    );
  };
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * 9;
    const a = Math.random() * Math.PI * 2;
    pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    // trampled patch where the goat stands
    const h = r < 1.2 ? 0.35 + Math.random() * 0.4 : 0.6 + Math.random() * 0.8;
    q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4));
    s.set(1 + Math.random(), h, 1);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    col.setHSL(0.2 + Math.random() * 0.06, 0.4 + Math.random() * 0.2, 0.3 + Math.random() * 0.15);
    mesh.setColorAt(i, col);
  }
  mesh.receiveShadow = true;
  return { mesh, material: mat };
}

function createFence(radius) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
  const posts = 36;
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.15, 8);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const p = new THREE.Mesh(postGeo, wood);
    p.position.set(Math.cos(a) * radius, 0.575, Math.sin(a) * radius);
    p.castShadow = true;
    g.add(p);
    const a2 = ((i + 1) / posts) * Math.PI * 2;
    const len = 2 * radius * Math.sin(Math.PI / posts);
    for (const h of [0.45, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.035), wood);
      const am = (a + a2) / 2;
      rail.position.set(Math.cos(am) * radius * Math.cos(Math.PI / posts), h, Math.sin(am) * radius * Math.cos(Math.PI / posts));
      rail.rotation.y = -am + Math.PI / 2;
      rail.castShadow = true;
      g.add(rail);
    }
  }
  return g;
}

function createHayBale() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#c8b06a';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    x.strokeStyle = `hsla(${42 + Math.random() * 12}, ${40 + Math.random() * 30}%, ${45 + Math.random() * 30}%, 0.7)`;
    x.beginPath();
    const px = Math.random() * 256, py = Math.random() * 256, a = (Math.random() - 0.5) * 0.8;
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * 25, py + Math.sin(a) * 25);
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.position.y = 0.225;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return g;
}

function createTrees() {
  const g = new THREE.Group();
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const r = 22 + Math.random() * 30;
    const t = new THREE.Group();
    const h = 3 + Math.random() * 3;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, h, 8), trunk);
    tr.position.y = h / 2;
    t.add(tr);
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + Math.random(), 1), leaf);
      b.position.set((Math.random() - 0.5) * 1.5, h + Math.random() * 1.2, (Math.random() - 0.5) * 1.5);
      t.add(b);
    }
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(t);
  }
  return g;
}
