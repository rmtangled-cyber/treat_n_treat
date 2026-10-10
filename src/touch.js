// Touch controls for phones / tablets.
//  - left side: a floating virtual joystick to walk
//  - anywhere else on the screen: drag to look around
//  - right-hand buttons: offer food (hold), focus (hold), crouch, lean left/right
//  - top-right tools: menu, slow motion, rumination, call her name, jaw monitor, fur quality
// Built on Pointer Events so several fingers can be used at once.

const LOOK_SPEED = 0.0042; // radians per CSS pixel
const JOY_RADIUS = 56;

export function isTouchDevice(params) {
  if (params.has('touch')) return true;
  if (params.has('desktop')) return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
}

function el(tag, cls, html, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

function capture(target, id) {
  try {
    target.setPointerCapture(id);
  } catch (e) {
    /* synthetic events or already released */
  }
}

export class TouchControls {
  constructor(player, actions) {
    this.player = player;
    this.actions = actions;
    const root = (this.root = el('div', 'hidden', '', document.body));
    root.id = 'touch-ui';
    this.surface = el('div', '', '', root);
    this.surface.id = 'touch-surface';

    // joystick (rests faintly at the lower left as a hint, follows the thumb)
    this.joyBase = el('div', 'joy-base idle', '<div class="joy-knob"></div>', root);
    this.joyKnob = this.joyBase.firstChild;
    this.joyId = null;
    this.lookId = null;

    // action buttons
    const pad = el('div', 'tpad', '', root);
    this.feedBtn = el('button', 'tbtn tbtn-feed', '<span class="ico">🥕</span><span>あげる</span>', pad);
    this.focusBtn = el('button', 'tbtn tbtn-focus', '<span class="ico">👁</span><span>注視</span>', pad);
    this.crouchBtn = el('button', 'tbtn tbtn-crouch', '<span class="ico">⬇</span><span class="lbl">立ち</span>', pad);
    this.leanL = el('button', 'tbtn tbtn-lean tbtn-lean-l', '◀', pad);
    this.leanR = el('button', 'tbtn tbtn-lean tbtn-lean-r', '▶', pad);

    this.hold(this.feedBtn, (on) => (player.offering = on));
    this.hold(this.focusBtn, (on) => (player.focus = on));
    this.hold(this.leanL, (on) => (player.leanInput = on ? -1 : player.leanInput === -1 ? 0 : player.leanInput));
    this.hold(this.leanR, (on) => (player.leanInput = on ? 1 : player.leanInput === 1 ? 0 : player.leanInput));
    this.tap(this.crouchBtn, () => {
      player.cycleStance();
      this.crouchBtn.querySelector('.lbl').textContent = player.stanceLabel;
    });

    // tools
    const tools = el('div', 'ttools', '', root);
    const tool = (label, fn) => this.tap(el('button', 'ttool', label, tools), fn);
    tool('≡', () => actions.menu());
    this.slowBtn = el('button', 'ttool', 'スロー', tools);
    this.tap(this.slowBtn, () => actions.slow());
    tool('反芻', () => actions.ruminate());
    tool('呼ぶ', () => actions.call());
    tool('軌跡', () => actions.jaw());
    tool('毛並み', () => actions.fur());

    this.bindSurface();
    // stop iOS page zoom / callouts
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show() {
    this.root.classList.remove('hidden');
    this.player.touchActive = true;
  }

  hide() {
    this.root.classList.add('hidden');
    this.player.touchActive = false;
    this.release();
  }

  release() {
    const p = this.player;
    p.offering = p.focus = false;
    p.leanInput = 0;
    p.moveInput.x = p.moveInput.y = 0;
    this.joyId = this.lookId = null;
    this.joyBase.classList.add('idle');
    this.joyBase.style.left = this.joyBase.style.top = '';
    this.joyKnob.style.transform = '';
    for (const b of this.root.querySelectorAll('.tbtn')) b.classList.remove('on');
  }

  hold(btn, fn) {
    const ids = new Set();
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(btn, e.pointerId);
      ids.add(e.pointerId);
      btn.classList.add('on');
      fn(true);
    });
    const up = (e) => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) {
        btn.classList.remove('on');
        fn(false);
      }
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    return btn;
  }

  tap(btn, fn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('on');
      setTimeout(() => btn.classList.remove('on'), 150);
      fn();
    });
    return btn;
  }

  bindSurface() {
    const s = this.surface;
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const w = innerWidth, h = innerHeight;
      const inJoyZone = e.clientX < w * 0.42 && e.clientY > h * 0.3;
      if (inJoyZone && this.joyId === null) {
        this.joyId = e.pointerId;
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joyBase.classList.remove('idle');
        this.joyBase.style.left = `${e.clientX}px`;
        this.joyBase.style.top = `${e.clientY}px`;
        this.joyKnob.style.transform = 'translate(-50%, -50%)';
        capture(s, e.pointerId);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        capture(s, e.pointerId);
      }
    });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) {
        let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > JOY_RADIUS) {
          dx *= JOY_RADIUS / d;
          dy *= JOY_RADIUS / d;
        }
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        // small dead zone so a resting thumb does not drift
        const nx = dx / JOY_RADIUS, ny = dy / JOY_RADIUS;
        const m = Math.hypot(nx, ny);
        const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / m;
        this.player.moveInput.x = nx * k;
        this.player.moveInput.y = -ny * k;
      } else if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lookLast.x, dy = e.clientY - this.lookLast.y;
        this.lookLast = { x: e.clientX, y: e.clientY };
        this.player.look(dx, dy, LOOK_SPEED);
      }
    });
    const end = (e) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.player.moveInput.x = this.player.moveInput.y = 0;
        this.joyBase.classList.add('idle');
        this.joyBase.style.left = this.joyBase.style.top = '';
        this.joyKnob.style.transform = '';
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }

  setSlowmo(scale) {
    this.slowBtn.textContent = scale === 1 ? 'スロー' : scale === 0.5 ? 'スロー½' : 'スロー¼';
    this.slowBtn.classList.toggle('active', scale !== 1);
  }
}
