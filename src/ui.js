// HUD: food selector, behaviour status and the jaw-trajectory monitor.
export class HUD {
  constructor(foods, onSelect) {
    this.bar = document.getElementById('food-bar');
    this.statusMain = document.getElementById('status-main');
    this.statusSub = document.getElementById('status-sub');
    this.jawPanel = document.getElementById('jaw-panel');
    this.jawCanvas = document.getElementById('jaw-canvas');
    this.jawInfo = document.getElementById('jaw-info');
    this.hintEl = document.getElementById('hint');
    this.slowEl = document.getElementById('slowmo');
    this.jctx = this.jawCanvas.getContext('2d');
    this.items = foods.map((f, i) => {
      const el = document.createElement('div');
      el.className = 'food-item';
      el.innerHTML = `<div class="k">${f.type.key}</div><div>${f.type.label}</div><div class="n"></div>`;
      this.bar.appendChild(el);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect && onSelect(i);
      });
      return el;
    });
    this.lastMain = this.lastSub = '';
  }
  setFood(index, foods) {
    this.items.forEach((el, i) => {
      el.classList.toggle('sel', i === index);
      const f = foods[i];
      el.querySelector('.n').textContent = f.bitesLeft > 0 ? `残り ${f.bitesLeft} 口` : '補充中…';
    });
  }
  setStatus(st, extra) {
    if (st.main !== this.lastMain) this.statusMain.textContent = this.lastMain = st.main;
    const sub = st.sub + '\n' + extra;
    if (sub !== this.lastSub) this.statusSub.textContent = this.lastSub = sub;
  }
  hint(text) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = setTimeout(() => this.hintEl.classList.remove('show'), 2200);
  }
  setSlowmo(s) {
    this.slowEl.textContent = s === 1 ? '' : `スロー ${s === 0.5 ? '½' : '¼'}×`;
  }
  toggleJaw() {
    this.jawPanel.classList.toggle('hidden');
  }
  drawJaw(ctrl) {
    if (this.jawPanel.classList.contains('hidden')) return;
    const g = this.jctx, W = 220, H = 160;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = 22, s = 4.6; // px per mm
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, 8);
    g.lineTo(cx, H - 6);
    g.moveTo(14, cy);
    g.lineTo(W - 14, cy);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '10px sans-serif';
    g.fillText('ゆきの右', 6, cy - 6);
    g.fillText('ゆきの左', W - 48, cy - 6);
    g.fillText('開口', cx + 4, H - 8);
    const tr = ctrl.jawTrace;
    const now = ctrl.time;
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      const age = (now - b.t) / 2.6;
      g.strokeStyle = `rgba(233,196,106,${Math.max(0, 1 - age)})`;
      g.lineWidth = 2;
      g.beginPath();
      // viewed from the front: the goat's left (+x) appears on the right
      g.moveTo(cx + a.x * 1000 * s, cy - a.y * 1000 * s);
      g.lineTo(cx + b.x * 1000 * s, cy - b.y * 1000 * s);
      g.stroke();
    }
    if (tr.length) {
      const b = tr[tr.length - 1];
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(cx + b.x * 1000 * s, cy - b.y * 1000 * s, 3, 0, Math.PI * 2);
      g.fill();
    }
    const c = ctrl.chew;
    const rate = Math.round(ctrl.chewRatePerMin());
    this.jawInfo.textContent = c.active
      ? `作業側：${c.side > 0 ? '左' : '右'}　${rate ? rate + ' 回/分' : ''}\n開口 → 作業側へ → 閉口 → 正中へすりつぶし`
      : '咀嚼していません';
  }
}
