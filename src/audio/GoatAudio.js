// Procedural, spatialised goat sounds (Web Audio API, no samples).
//
//  - chewing: a crunch per power stroke made of many tiny filtered noise
//    "fracture" grains + a low tooth-impact thud conducted through the skull,
//    turning into wet squelch / grinding as the bolus breaks down
//  - rumination: softer, very regular wet grinding
//  - bleat: buzzy glottal source (f0 ≈ 300–450 Hz) pulsed at ~9–11 Hz
//    (the segmented "meh-eh-eh" quaver), formant-filtered, energy around
//    1–1.3 kHz like measured adult doe calls (Ruiz-Miranda et al. 1993)
//  - bites (carrot snap, apple crunch+juice, hay pull, leaf tear), swallow
//    gulp, regurgitation, sniffing, breathing, ambient wind and birds
// Everything from the mouth goes through an HRTF panner placed at the lips,
// so you hear it louder and more detailed as you lean in.

export class GoatAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.timeScale = 1;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iOS: let Web Audio play even when the ring/silent switch is on
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {
      /* not supported */
    }
    const ctx = (this.ctx = new AC());
    this.enabled = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffers
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }

    // mouth bus -> near-field "presence" shelf -> HRTF panner
    this.mouth = this.makePanner(0.22, 1.6);
    this.mouthBus = ctx.createGain();
    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'highshelf';
    this.presence.frequency.value = 3500;
    this.presence.gain.value = 0;
    this.mouthBus.connect(this.presence).connect(this.mouth);
    this.mouth.connect(this.master);

    // body (rumen gurgles)
    this.body = this.makePanner(0.4, 1.4);
    this.bodyBus = ctx.createGain();
    this.bodyBus.connect(this.body);
    this.body.connect(this.master);

    // continuous breathing noise through the nostrils
    this.breathSrc = this.loopNoise(this.white);
    this.breathFilter = ctx.createBiquadFilter();
    this.breathFilter.type = 'bandpass';
    this.breathFilter.frequency.value = 900;
    this.breathFilter.Q.value = 0.6;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breathSrc.connect(this.breathFilter).connect(this.breathGain).connect(this.mouthBus);

    this.startAmbient();
  }

  makePanner(ref, rolloff) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 50;
    p.rolloffFactor = rolloff;
    return p;
  }

  loopNoise(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  get now() {
    return this.ctx.currentTime;
  }

  // ------------------------------------------------------------- spatial
  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.getWorldPosition(_v1);
    const f = camera.getWorldDirection(_v2);
    const u = _v3.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(_q));
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    this.listenerPos = p.clone();
  }

  updateSources(mouthPos, bodyPos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    setPos(this.mouth, mouthPos, t);
    setPos(this.body, bodyPos, t);
    if (this.listenerPos) {
      // the closer you lean in, the more you hear the fine crackle
      const d = this.listenerPos.distanceTo(mouthPos);
      const g = d < 0.7 ? (0.7 - d) / 0.55 : 0;
      this.presence.gain.setTargetAtTime(Math.min(1, g) * 7, t, 0.05);
    }
  }

  setBreath(level, inhale) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.breathGain.gain.setTargetAtTime(level * 0.05, t, 0.05);
    this.breathFilter.frequency.setTargetAtTime(inhale ? 1400 : 800, t, 0.1);
  }

  // ------------------------------------------------------------- primitives
  noiseBurst({ t, dur, type = 'bandpass', freq = 2000, q = 1, gain = 0.5, attack = 0.001, buf, bus, freqEnd, curve = 'exp' }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buf || this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.mouthBus);
    s.start(t, Math.random() * 1.8, dur + 0.05);
    return g;
  }

  tone({ t, dur, f0, f1, gain = 0.3, type = 'sine', bus, attack = 0.004 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.mouthBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------- chewing
  // One power stroke of a chewing cycle.
  // p: { hardness, wetness, fibre, progress (0 fresh .. 1 mush), side, rumination, energy }
  chew(p) {
    if (!this.ctx) return;
    const t = this.now + 0.005;
    const fresh = 1 - p.progress;
    const e = (p.energy ?? 1) * 2.6;
    if (p.rumination) {
      // soft, wet, very regular grinding of the cud
      this.noiseBurst({ t, dur: 0.22, type: 'bandpass', freq: 420 + Math.random() * 120, q: 0.9, gain: 0.24 * e, attack: 0.06, buf: this.brown, curve: 'lin' });
      this.noiseBurst({ t: t + 0.03, dur: 0.16, type: 'bandpass', freq: 1500 + Math.random() * 500, q: 1.4, gain: 0.035 * e, attack: 0.04 });
      this.wetClicks(t + 0.08, 2, 0.03 * e);
      this.tone({ t, dur: 0.06, f0: 95, f1: 60, gain: 0.06 * e });
      return;
    }
    const hard = p.hardness * (0.25 + 0.75 * fresh * fresh);
    // fracture grains (the "crunch")
    const grains = Math.round(2 + 22 * hard + 10 * p.fibre * fresh);
    for (let i = 0; i < grains; i++) {
      const dt = Math.pow(Math.random(), 1.6) * (0.06 + 0.08 * p.fibre);
      const fibreGrain = Math.random() < p.fibre;
      this.noiseBurst({
        t: t + dt,
        dur: fibreGrain ? 0.004 + Math.random() * 0.006 : 0.006 + Math.random() * 0.014,
        type: fibreGrain ? 'highpass' : 'bandpass',
        freq: fibreGrain ? 3500 + Math.random() * 3500 : (900 + Math.random() * 4200) * (0.75 + 0.5 * p.hardness),
        q: fibreGrain ? 0.7 : 1.2 + Math.random() * 3,
        gain: (0.18 + Math.random() * 0.4) * (0.35 + hard) * e * (fibreGrain ? 0.55 : 1),
      });
    }
    // tooth impact conducted through the skull
    this.tone({ t, dur: 0.07, f0: 140 + 40 * p.hardness, f1: 65, gain: (0.12 + 0.25 * hard) * e });
    // grinding / squelch as the bolus softens
    const mush = p.progress;
    this.noiseBurst({ t: t + 0.01, dur: 0.18, type: 'lowpass', freq: 700 + 500 * p.wetness, q: 0.7, gain: (0.05 + 0.18 * mush) * (0.4 + p.wetness) * e, attack: 0.04, buf: this.brown, curve: 'lin' });
    if (p.wetness > 0.2) {
      this.wetClicks(t + 0.05, Math.round(1 + 4 * p.wetness * (0.3 + mush)), 0.06 * p.wetness * e);
      if (p.wetness > 0.7 && fresh > 0.4) {
        // juice
        this.noiseBurst({ t: t + 0.02, dur: 0.12, type: 'bandpass', freq: 2600, q: 1.5, gain: 0.08 * fresh * e, attack: 0.01 });
      }
    }
    if (p.fibre > 0.4) {
      // dry stems creaking against the molars
      this.noiseBurst({ t: t + 0.02, dur: 0.14, type: 'bandpass', freq: 1200 + Math.random() * 600, q: 6, gain: 0.05 * p.fibre * e, attack: 0.02 });
    }
  }

  // tongue / saliva clicks when the lips and tongue separate
  wetClicks(t, n, gain) {
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * 0.12;
      this.noiseBurst({ t: tt, dur: 0.012 + Math.random() * 0.012, type: 'bandpass', freq: 700 + Math.random() * 1400, q: 4 + Math.random() * 4, gain: gain * (0.5 + Math.random()) });
    }
  }

  // jaw opening with a wet mouth: a little smack
  lipSmack(gain = 0.04) {
    if (!this.ctx) return;
    this.wetClicks(this.now, 2, gain);
  }

  bite(kind) {
    if (!this.ctx) return;
    const t = this.now + 0.005;
    const bus = this.mouthBus;
    this.mouthBus = this.biteBus || (this.biteBus = (() => { const g = this.ctx.createGain(); g.gain.value = 2.2; g.connect(bus); return g; })());
    try { this.biteInner(kind, t); } finally { this.mouthBus = bus; }
  }

  biteInner(kind, t) {
    if (kind === 'snap') {
      this.noiseBurst({ t, dur: 0.006, type: 'highpass', freq: 1500, q: 0.7, gain: 0.9 });
      this.noiseBurst({ t: t + 0.002, dur: 0.07, type: 'bandpass', freq: 2700, q: 7, gain: 0.5 });
      this.noiseBurst({ t: t + 0.004, dur: 0.05, type: 'bandpass', freq: 1500, q: 5, gain: 0.35 });
      for (let i = 0; i < 9; i++) this.noiseBurst({ t: t + 0.01 + Math.random() * 0.07, dur: 0.01, freq: 2000 + Math.random() * 4000, q: 2, gain: 0.25 });
      this.tone({ t, dur: 0.08, f0: 190, f1: 70, gain: 0.35 });
    } else if (kind === 'apple') {
      for (let i = 0; i < 14; i++) this.noiseBurst({ t: t + Math.random() * 0.09, dur: 0.014, freq: 1200 + Math.random() * 3500, q: 2, gain: 0.35 });
      this.noiseBurst({ t: t + 0.03, dur: 0.22, type: 'bandpass', freq: 3200, q: 1.2, gain: 0.12, attack: 0.02 });
      this.noiseBurst({ t: t + 0.05, dur: 0.18, type: 'lowpass', freq: 900, q: 1, gain: 0.15, buf: this.brown, attack: 0.03 });
      this.tone({ t, dur: 0.07, f0: 170, f1: 70, gain: 0.25 });
    } else if (kind === 'pull') {
      const g = this.noiseBurst({ t, dur: 0.45, type: 'highpass', freq: 2600, q: 0.6, gain: 0.22, attack: 0.05, curve: 'lin' });
      for (let i = 0; i < 12; i++) this.noiseBurst({ t: t + Math.random() * 0.4, dur: 0.006, type: 'highpass', freq: 4000, q: 0.7, gain: 0.3 });
      this.noiseBurst({ t: t + 0.05, dur: 0.3, type: 'bandpass', freq: 1300, q: 5, gain: 0.06, attack: 0.05 });
    } else if (kind === 'tear') {
      // leaf blade ripping + petiole snap
      const s = this.ctx.createBufferSource();
      s.buffer = this.white;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2200;
      f.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 18; i++) g.gain.setValueAtTime(Math.random() * 0.3, t + i * 0.014);
      g.gain.setValueAtTime(0, t + 0.26);
      s.connect(f).connect(g).connect(this.mouthBus);
      s.start(t, 0, 0.3);
      this.noiseBurst({ t: t + 0.24, dur: 0.012, type: 'highpass', freq: 1800, gain: 0.5 });
    }
  }

  swallow() {
    if (!this.ctx) return;
    const t = this.now + 0.01;
    this.tone({ t, dur: 0.16, f0: 230, f1: 60, gain: 0.5 });
    this.noiseBurst({ t, dur: 0.12, type: 'lowpass', freq: 500, q: 1, gain: 0.4, buf: this.brown, attack: 0.01 });
    this.wetClicks(t + 0.02, 2, 0.05);
  }

  regurgitate() {
    if (!this.ctx) return;
    const t = this.now + 0.01;
    // soft "hup" from the throat, then the rumen rumbles
    this.tone({ t, dur: 0.18, f0: 85, f1: 140, gain: 0.25 });
    this.noiseBurst({ t, dur: 0.2, type: 'lowpass', freq: 420, q: 1.5, gain: 0.25, buf: this.brown, attack: 0.03 });
    this.rumen(0.6);
  }

  rumen(amount = 1) {
    if (!this.ctx) return;
    const t = this.now;
    const n = Math.round(4 + 6 * amount);
    for (let i = 0; i < n; i++) {
      const tt = t + 0.1 + Math.random() * 1.6;
      const f = 120 + Math.random() * 260;
      this.tone({ t: tt, dur: 0.05 + Math.random() * 0.1, f0: f, f1: f * (0.6 + Math.random() * 0.9), gain: 0.06 * amount, bus: this.bodyBus });
    }
    this.noiseBurst({ t, dur: 1.4, type: 'lowpass', freq: 220, q: 2, gain: 0.12 * amount, buf: this.brown, bus: this.bodyBus, attack: 0.4, curve: 'lin' });
  }

  sniff(count = 3) {
    if (!this.ctx) return;
    const t = this.now;
    for (let i = 0; i < count; i++) {
      this.noiseBurst({ t: t + i * 0.13, dur: 0.075, type: 'bandpass', freq: 3200 + Math.random() * 1500, q: 0.9, gain: 0.12, attack: 0.02 });
    }
  }

  snort() {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseBurst({ t, dur: 0.25, type: 'bandpass', freq: 1200, q: 0.8, gain: 0.25, attack: 0.008 });
    this.noiseBurst({ t, dur: 0.15, type: 'lowpass', freq: 300, q: 1, gain: 0.2, buf: this.brown, attack: 0.008 });
  }

  // Returns the bleat duration. `env(t)` lets the animation follow the sound.
  bleat({ pitch = 1, length = 1, pulse = 10 } = {}) {
    if (!this.ctx) return { duration: 0.9 * length, pulse };
    const ctx = this.ctx;
    const t = this.now + 0.03;
    const dur = (0.75 + Math.random() * 0.35) * length;
    const f0 = 335 * pitch * (0.95 + Math.random() * 0.1);

    const out = ctx.createGain();
    out.gain.value = 0;
    // amplitude envelope
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.65, t + 0.07);
    out.gain.setValueAtTime(0.65, t + dur * 0.7);
    out.gain.linearRampToValueAtTime(0.36, t + dur * 0.85);
    out.gain.linearRampToValueAtTime(0, t + dur);

    // segmented quaver: deep AM + FM at ~10 Hz
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(pulse * 0.85, t);
    lfo.frequency.linearRampToValueAtTime(pulse * 1.1, t + dur);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3) * 0.5 + 0.5; // 0..1, squared-off pulses
    }
    shaper.curve = curve;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.75;
    const am = ctx.createGain();
    am.gain.value = 0.25;
    lfo.connect(shaper).connect(amDepth).connect(am.gain);
    const fmDepth = ctx.createGain();
    fmDepth.gain.value = f0 * 0.045;

    // glottal source: two slightly detuned saws + breath noise
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    for (const [o, k] of [[o1, 1], [o2, 1.006]]) {
      o.frequency.setValueAtTime(f0 * 0.82 * k, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.08 * k, t + dur * 0.3);
      o.frequency.linearRampToValueAtTime(f0 * 0.92 * k, t + dur * 0.75);
      o.frequency.linearRampToValueAtTime(f0 * 0.72 * k, t + dur);
      lfo.connect(fmDepth).connect(o.frequency);
    }
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o2.connect(g2);
    const src = ctx.createGain();
    o1.connect(src);
    g2.connect(src);
    const breath = ctx.createBufferSource();
    breath.buffer = this.white;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 2200;
    bf.Q.value = 0.8;
    const bg = ctx.createGain();
    bg.gain.value = 0.22;
    breath.connect(bf).connect(bg).connect(src);

    // "m" -> "eh": lowpass opens as the mouth opens
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.exponentialRampToValueAtTime(5200, t + 0.12);
    lp.frequency.setValueAtTime(5200, t + dur * 0.75);
    lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
    src.connect(am).connect(lp);

    // formants (nasal "eh")
    const formants = [
      [720, 5, 1.0],
      [1250, 6, 0.9],
      [1750, 8, 0.6],
      [2750, 9, 0.35],
      [3600, 10, 0.18],
    ];
    for (const [f, q, a] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * 0.85, t);
      bp.frequency.linearRampToValueAtTime(f, t + 0.15);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = a * 1.6;
      lp.connect(bp).connect(g).connect(out);
    }
    out.connect(this.mouthBus);
    const stop = t + dur + 0.1;
    for (const n of [lfo, o1, o2]) {
      n.start(t);
      n.stop(stop);
    }
    breath.start(t, Math.random(), dur + 0.1);
    return { duration: dur, pulse, start: t };
  }

  // ------------------------------------------------------------- player
  footstep(intensity = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseBurst({ t, dur: 0.12, type: 'bandpass', freq: 1800 + Math.random() * 1200, q: 0.7, gain: 0.05 * intensity, attack: 0.02, bus: this.master });
    this.noiseBurst({ t, dur: 0.06, type: 'lowpass', freq: 300, q: 1, gain: 0.05 * intensity, buf: this.brown, bus: this.master });
  }

  // ------------------------------------------------------------- ambience
  startAmbient() {
    const ctx = this.ctx;
    const wind = this.loopNoise(this.brown);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    const wg = ctx.createGain();
    wg.gain.value = 0.025;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.015;
    lfo.connect(lg).connect(wg.gain);
    lfo.start();
    wind.connect(wf).connect(wg).connect(this.master);
    // leaves rustling
    const rustle = this.loopNoise(this.white);
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 3000;
    const rg = ctx.createGain();
    rg.gain.value = 0.006;
    rustle.connect(rf).connect(rg).connect(this.master);
    const bird = () => {
      if (!this.ctx) return;
      const t = this.now;
      const n = 2 + Math.floor(Math.random() * 5);
      const base = 2600 + Math.random() * 2200;
      for (let i = 0; i < n; i++) {
        const tt = t + i * (0.08 + Math.random() * 0.06);
        this.tone({ t: tt, dur: 0.06 + Math.random() * 0.05, f0: base * (0.9 + Math.random() * 0.3), f1: base * (1.1 + Math.random() * 0.4), gain: 0.012, bus: this.master });
      }
      setTimeout(bird, 3000 + Math.random() * 9000);
    };
    setTimeout(bird, 2000);
  }
}

import * as THREE from 'three';
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
function setPos(p, v, t) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(v.x, t, 0.02);
    p.positionY.setTargetAtTime(v.y, t, 0.02);
    p.positionZ.setTargetAtTime(v.z, t, 0.02);
  } else p.setPosition(v.x, v.y, v.z);
}
