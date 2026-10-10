// Runs SDF meshing jobs in Web Workers (falls back to the main thread).
import * as THREE from 'three';
import { runJob } from './goat/meshJobs.js';

export function runJobsParallel(names, onProgress) {
  let workers = [];
  const canWork = typeof Worker !== 'undefined';
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve, reject) => {
          if (!canWork) return resolve(runJob(name));
          let w;
          try {
            w = new Worker(new URL('./goat/meshWorker.js', import.meta.url), { type: 'module' });
          } catch (e) {
            return resolve(runJob(name));
          }
          workers.push(w);
          w.onmessage = (e) => {
            w.terminate();
            onProgress && onProgress(name);
            if (e.data.error) reject(new Error(e.data.error));
            else resolve(e.data.result);
          };
          w.onerror = (e) => {
            w.terminate();
            // fall back to the main thread
            try { resolve(runJob(name)); } catch (err) { reject(err); }
          };
          w.postMessage({ id: name, name });
        })
    )
  );
}

export function toGeometry(r, { skinned = false } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
  g.setIndex(new THREE.BufferAttribute(r.indices, 1));
  if (r.color) g.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(r.color), 3));
  if (r.fur) g.setAttribute('aFur', new THREE.BufferAttribute(r.fur, 1));
  if (r.aux) g.setAttribute('aAux', new THREE.BufferAttribute(r.aux, 2));
  if (skinned) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(r.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(r.skinWeight, 4));
  }
  if (r.groups) for (const gr of r.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingSphere();
  return g;
}


// colours are authored in sRGB; three.js expects linear vertex colours
export function srgbToLinear(arr) {
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    arr[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return arr;
}
