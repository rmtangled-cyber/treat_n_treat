// Goat materials: fur base coat, sparse-hair skin, wet oral mucosa, shell fur,
// plus a shared vertex patch for breathing, swallowing (bolus travelling in
// the left jugular groove), nostril flare and cheek bulge.
import * as THREE from 'three';

export const goatUniforms = {
  uBolus: { value: new THREE.Vector4(0, 0, 0, 0) }, // xyz bind-space position, w amplitude
  uBolusR: { value: 0.02 },
  uBreath: { value: 0 },
  uNostril: { value: 0 },
  uCheek: { value: new THREE.Vector2(0, 0) },
  uFurLen: { value: 0.011 },
  uComb: { value: new THREE.Vector3(0, -0.55, -0.45) },
};

const VERT_DECL = /* glsl */ `
uniform vec4 uBolus;
uniform float uBolusR;
uniform float uBreath;
uniform float uNostril;
uniform vec2 uCheek;
uniform float uFurLen;
uniform vec3 uComb;
uniform float uShell;
attribute float aFur;
attribute vec2 aAux;
varying vec3 vRest;
varying float vFur;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
vRest = position;
vFur = aFur;
{
  float bd = distance(position, uBolus.xyz);
  transformed += normal * uBolus.w * exp(-bd * bd / (uBolusR * uBolusR));
  float bm = smoothstep(0.42, 0.52, position.y) * smoothstep(0.8, 0.66, position.y)
           * smoothstep(-0.3, -0.08, position.z) * smoothstep(0.34, 0.14, position.z);
  transformed += normal * uBreath * bm;
  transformed += normal * uNostril * aAux.x * 0.0016;
  float ch = aAux.y > 0.0 ? uCheek.x : uCheek.y;
  transformed += normal * ch * abs(aAux.y) * 0.005;
#ifdef FUR_SHELL
  transformed += (normal * uShell + uComb * uShell * uShell) * uFurLen * aFur;
#endif
}
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vRest;
varying float vFur;
uniform float uShell;
float gHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const FRAG_SHELL = /* glsl */ `
#include <clipping_planes_fragment>
#ifdef FUR_SHELL
{
  vec3 sp = vRest * 1150.0;
  vec3 ip = floor(sp);
  vec3 fp = fract(sp) - 0.5;
  float r1 = gHash13(ip);
  float rad = (1.0 - uShell) * (0.42 + 0.3 * r1);
  if (vFur < 0.06 || length(fp) > rad || r1 < uShell * 0.3) discard;
}
#endif
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
{
  float g = gHash13(floor(vRest * 1150.0));
#ifdef FUR_SHELL
  diffuseColor.rgb *= mix(0.6, 1.06, uShell) * (0.93 + 0.1 * g);
#else
  diffuseColor.rgb *= mix(1.0, 0.86 + 0.14 * g, clamp(vFur, 0.0, 1.0));
#endif
}
`;

function patch(material, shell) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, goatUniforms);
    shader.uniforms.uShell = material.userData.uShell;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', FRAG_SHELL)
      .replace('#include <color_fragment>', FRAG_COLOR);
  };
  material.userData.uShell = { value: 0 };
  if (shell) material.defines = { ...(material.defines || {}), FUR_SHELL: '' };
  material.customProgramCacheKey = () => (shell ? 'goat-shell' : 'goat-base');
  return material;
}

export function createGoatMaterials() {
  const fur = patch(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0,
    sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.95, 0.93, 0.88),
  }));
  const skin = patch(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45,
  }));
  const mucosa = patch(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  }));
  const shells = [];
  return { fur, skin, mucosa, shells, list: [fur, skin, mucosa] };
}

export function createShellMaterial(layer) {
  const m = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), true);
  m.userData.uShell.value = layer;
  return m;
}

// Goat eye: amber iris with radial fibres and a horizontal, rounded-rectangle
// pupil, computed procedurally from the eye-space direction (+Z = gaze).
export function createEyeMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02,
  });
  m.userData.uDilate = { value: 1 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDilate = m.userData.uDilate;
    shader.vertexShader = 'varying vec3 vEyeP;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = normalize(position);');
    shader.fragmentShader = `varying vec3 vEyeP;\nuniform float uDilate;\n
      float eHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float eNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(eHash(i),eHash(i+vec2(1,0)),f.x), mix(eHash(i+vec2(0,1)),eHash(i+vec2(1,1)),f.x), f.y); }
    ` + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      {
        vec3 n = normalize(vEyeP);
        float th = acos(clamp(n.z, -1.0, 1.0));
        float ang = atan(n.y, n.x);
        vec2 t = n.xy;
        float irisR = 0.68;
        float r = th / irisR;
        vec3 sclera = vec3(0.62, 0.55, 0.46);
        vec3 iris = mix(vec3(0.62, 0.34, 0.06), vec3(0.86, 0.58, 0.16), eNoise(vec2(ang * 9.0, r * 3.0)));
        float fib = eNoise(vec2(ang * 38.0, r * 6.0));
        iris *= 0.8 + 0.35 * fib;
        iris = mix(iris, vec3(0.45, 0.28, 0.08), smoothstep(0.2, 0.0, r - 0.32) * 0.5); // collarette
        iris = mix(iris, vec3(0.22, 0.13, 0.05), smoothstep(0.78, 1.0, r)); // limbal ring
        vec3 col = mix(iris, sclera, smoothstep(0.98, 1.06, r));
        // horizontal rectangular pupil (rounded box in the tangent plane)
        vec2 hs = vec2(0.3, 0.075) * uDilate;
        vec2 q = abs(t) - hs + 0.05;
        float pd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.05;
        if (n.z > 0.0) col = mix(vec3(0.015, 0.012, 0.01), col, smoothstep(-0.006, 0.01, pd));
        // granula iridica: little dark bumps on the upper pupil margin
        float gr = smoothstep(0.03, 0.0, abs(t.y - hs.y - 0.01)) * step(abs(t.x), hs.x * 0.8) * eNoise(vec2(t.x * 60.0, 1.0));
        col = mix(col, vec3(0.12, 0.08, 0.03), gr * 0.8);
        diffuseColor.rgb = col;
      }
    `);
  };
  return m;
}
