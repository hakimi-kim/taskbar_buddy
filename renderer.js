// Tuning knobs.
const BUDDY_X = 150;       // px from the left edge where the buddy sits (just right of the Widgets button)
const DRAW_SCALE = 1.25;   // drawing-form height relative to taskbar height (>1 so it pokes above the bar)
const SCENE_OPACITY = 0.55; // taskbar art opacity; lower it if icons are hard to see

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const [scene, holeEl, buddy, rig, bob, armL, armR, legL, legR, lids, chalk, bubble, thanks] =
  ['scene', 'hole', 'buddy', 'rig', 'bob', 'armL', 'armR', 'legL', 'legR', 'lids', 'chalk', 'bubble', 'thanks'].map($);
const api = window.buddyApi;
const SPEED = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.01 : 1;
const ASPECT = 200 / 260;

let L, pendingLayout, busy = false;
let B, bw;                      // drawing-form height/width in px
let pos = { x: 0, y: 0, h: 0 }; // buddy top-left + height, in screen px
let hole = { x: 0, y: 0 };      // clipping window the buddy lives in (its bottom edge = a portal/taskbar line)

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));
const to = (el, kf, ms, opts = {}) =>
  el.animate(kf, { duration: ms * SPEED, easing: 'ease-in-out', fill: 'forwards', ...opts }).finished;
const loop = (el, kf, ms) => el.animate(kf, { duration: ms, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });

function place() {
  Object.assign(buddy.style, {
    left: pos.x - hole.x + 'px', top: pos.y - hole.y + 'px',
    height: pos.h + 'px', width: pos.h * ASPECT + 'px',
  });
}

function setHole(x, y, w, h) {
  hole = { x, y };
  Object.assign(holeEl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  place();
}

// Translate the buddy, then bake the result into left/top so the next step starts clean.
async function move(dx, dy, ms, { easing = 'ease-in-out', hop = 0, walk = false } = {}) {
  const mid = hop ? [{ transform: `translate(${dx / 2}px, ${dy / 2 - hop}px)`, offset: 0.5 }] : [];
  const legs = walk ? [
    loop(legL, [{ transform: 'rotate(-14deg)' }, { transform: 'rotate(14deg)' }], 200),
    loop(legR, [{ transform: 'rotate(14deg)' }, { transform: 'rotate(-14deg)' }], 200),
  ] : [];
  await to(buddy, [{ transform: 'none' }, ...mid, { transform: `translate(${dx}px, ${dy}px)` }], ms, { easing });
  legs.forEach((a) => a.cancel());
  pos.x += dx; pos.y += dy;
  place();
  buddy.getAnimations().forEach((a) => a.cancel());
}

const blink = () => lids.animate(
  [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)', offset: 0.5 }, { transform: 'scaleY(0)' }],
  { duration: 170 }).finished;
const squash = () => to(rig, [{ transform: 'scale(1.18, .82)' }, { transform: 'scale(.94, 1.06)' }, { transform: 'none' }], 320);
const armsTo = (t, ms, opts) => Promise.all([
  to(armL, { transform: t ? `rotate(100deg) scaleX(${t})` : 'none' }, ms, opts),
  to(armR, { transform: t ? `rotate(-100deg) scaleX(${t})` : 'none' }, ms, opts),
]);

function resetParts() {
  for (const el of [buddy, rig, armL, armR, legL, legR, chalk]) el.getAnimations().forEach((a) => a.cancel());
}

// ---------- chalk portals ----------
function portal(cx, cy, rx, ry) {
  const pad = 14, el = document.createElementNS(NS, 'svg');
  el.classList.add('portal');
  el.setAttribute('width', 2 * (rx + pad));
  el.setAttribute('height', 2 * (ry + pad));
  el.setAttribute('viewBox', `${-rx - pad} ${-ry - pad} ${2 * (rx + pad)} ${2 * (ry + pad)}`);
  Object.assign(el.style, { left: cx - rx - pad + 'px', top: cy - ry - pad + 'px' });
  let spiral = 'M0 0';
  for (let t = 0; t < 6 * Math.PI; t += 0.3) spiral += ` L${(rx * t / (6 * Math.PI)) * Math.cos(t)} ${(rx * t / (6 * Math.PI)) * Math.sin(t)}`;
  const rim = (dx, dy, color, w) =>
    `<ellipse class="rim" rx="${rx + dx}" ry="${ry + dy}" fill="none" stroke="${color}" stroke-width="${w}"
      stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`;
  el.innerHTML = `<g filter="url(#crayon)">
    <g class="swirl" opacity="0"><g transform="scale(1 ${ry / rx})"><g>
      <circle r="${rx}" fill="url(#void)"/>
      <path d="${spiral}" fill="none" stroke="#a58bf0" stroke-width="3" opacity=".7"/>
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.5s" repeatCount="indefinite"/>
    </g></g></g>
    ${rim(0, 0, 'rgba(0,0,0,.35)', 9)}${rim(0, 0, '#fdfdfd', 5)}${rim(3, 2, '#d9d9d9', 2)}
  </g>`;
  el.cx = cx;
  document.body.appendChild(el);
  return el;
}

async function openPortal(p, ms) {
  await Promise.all([...p.querySelectorAll('.rim')].map((r) => to(r, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], ms)));
  await to(p.querySelector('.swirl'), [{ opacity: 0 }, { opacity: 1 }], 300);
}

async function closePortal(p) {
  await to(p.querySelector('.swirl'), { opacity: 0 }, 250);
  await Promise.all([...p.querySelectorAll('.rim')].map((r) => to(r, { strokeDashoffset: -1 }, 500)));
  p.remove();
}

// ---------- taskbar scene (sketch 3), stretched to any taskbar width ----------
function drawScene() {
  const { W, H, T } = L, s = H / 55;
  const at = (x, y) => `transform="translate(${x} ${y}) scale(${s})"`;
  const tree = (x) => `<g ${at(x, H)}>
    <path d="M-5 2 L-3 -24 L3 -24 L5 2Z" fill="#9a6644" stroke="#5b3a26" stroke-width="2"/>
    <circle cy="-38" r="19" fill="#86c870" stroke="#3f8f3a" stroke-width="2.5"/>
    <path d="M1 -38 a3 3 0 1 1 -4 -2 a7 7 0 1 1 10 5 a12 12 0 1 1 -17 -12" fill="none" stroke="#4ea247" stroke-width="2"/></g>`;
  const grass = (x) => `<path ${at(x, H - 2)} d="M0 0 l3 -12 l3 10 l4 -15 l3 13 l5 -11 l1 13" fill="none" stroke="#3f8f3a" stroke-width="2.5"/>`;
  const hill = (a, b) => `<path d="M${a} ${H + 2} Q${(a + b) / 2} ${-H * 0.3} ${b} ${H + 2}Z" fill="#9bd685" stroke="#3f8f3a" stroke-width="2.5"/>`;
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, c = Math.cos(a), n = Math.sin(a);
    rays += `<path d="M${15 * c} ${15 * n} L${23 * c} ${23 * n}"/>`;
  }
  const bx = BUDDY_X + bw;
  scene.setAttribute('width', W);
  scene.setAttribute('height', H);
  Object.assign(scene.style, { top: T + 'px', opacity: SCENE_OPACITY });
  scene.innerHTML = `<g filter="url(#crayon)">
    <rect width="${W}" height="${H}" fill="#eaf4fd" opacity=".5"/><rect width="${W}" height="${H}" fill="url(#sky)"/>
    <g ${at(26, H * 0.45)} fill="none" stroke="#f0a430" stroke-width="3.5" stroke-linecap="round"><circle r="11"/>${rays}</g>
    ${hill(BUDDY_X - 70, bx + 130)}${hill(W * 0.66, W * 0.88)}
    ${grass(bx + 40)}${tree(bx + 90)}${grass(W * 0.64)}${tree(W * 0.72)}${grass(W * 0.77)}${tree(W * 0.83)}${grass(W - 60)}
  </g>`;
}

// ---------- idle ----------
function idlePose() {
  setHole(0, 0, L.W, L.SH);
  pos = { x: BUDDY_X, y: L.T + L.H - B - 2, h: B };
  place();
  buddy.classList.add('drawing');
}

function applyLayout(l) {
  L = l;
  B = Math.round(L.H * DRAW_SCALE);
  bw = B * ASPECT;
  drawScene();
  idlePose();
}

loop(bob, [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }], 1100);
(function blinkLoop() { blink(); setTimeout(blinkLoop, 3000 + Math.random() * 3000); })();
if (SPEED === 1) {
  const boil = $('boil');
  let seed = 0;
  setInterval(() => boil.setAttribute('seed', (seed = (seed + 1) % 3)), 160);
}

// ---------- the reminder ----------
function askBubble(CX, CY, BC, bwc) {
  bubble.style.display = 'block';
  const left = Math.max(16, CX - bwc * 0.35 - bubble.offsetWidth - 30);
  Object.assign(bubble.style, { left: left + 'px', top: Math.max(16, CY - BC * 0.55 - bubble.offsetHeight) + 'px' });
  bubble.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.08)', offset: 0.7 }, { transform: 'scale(1)' }], 380 * SPEED);
  bubble.onmouseenter = () => api.setClickable(true);
  bubble.onmouseleave = () => api.setClickable(false);
  return new Promise((resolve) => {
    thanks.onclick = async () => {
      thanks.onclick = null;
      api.setClickable(false);
      await bubble.animate([{ transform: 'scale(1)' }, { transform: 'scale(0)' }], 220 * SPEED).finished;
      bubble.style.display = 'none';
      resolve();
    };
  });
}

async function remind() {
  busy = true;
  const { W, SH, T } = L;

  // 1. wake up: blink twice, color comes in
  await blink(); await sleep(250); await blink(); await sleep(300);
  buddy.classList.remove('drawing');
  await sleep(300);

  // 2. stretch arms up to the top edge of the taskbar, then pull up onto it
  await armsTo(2.6, 450, { easing: 'cubic-bezier(.3,1.6,.6,1)' });
  await to(rig, { transform: 'scale(1.08, .9)' }, 200);
  await Promise.all([
    move(0, T - (pos.y + B), 700, { easing: 'cubic-bezier(.5,0,.3,1)' }),
    armsTo(1, 700),
    to(rig, { transform: 'scale(.92, 1.1)' }, 700),
  ]);
  await Promise.all([armsTo(0, 300), squash()]);

  // 3. chalk two portals at once: one on the taskbar, one mid-screen
  const CX = W / 2, CY = Math.round(SH * 0.55);
  const BC = Math.min(Math.round(SH * 0.34), 320), bwc = BC * ASPECT;
  const tp = portal(pos.x + bw * 1.9, T, bw * 0.75, bw * 0.22);
  const cp = portal(CX, CY, bwc * 0.66, bwc * 0.17);
  await to(chalk, { opacity: 1 }, 150);
  const scribble = loop(armR, [{ transform: 'rotate(-35deg)' }, { transform: 'rotate(-65deg)' }], 170);
  await Promise.all([openPortal(tp, 1300), openPortal(cp, 1300)]);
  scribble.cancel();
  await to(chalk, { opacity: 0 }, 150);

  // 4. hop into the taskbar portal (everything below the taskbar line is clipped)
  await move(tp.cx - bw / 2 - pos.x, 0, 500, { hop: B * 0.35, walk: true });
  setHole(0, 0, W, T);
  await to(rig, [{ transform: 'scale(1.15, .85)' }, { transform: 'scale(.9, 1.12)' }], 180);
  await move(0, B + 6, 420, { easing: 'cubic-bezier(.5,0,1,1)', hop: B * 0.7 });
  await to(rig, { transform: 'none' }, 1);

  // 5. rise half-way out of the center portal, bigger, and talk
  setHole(0, 0, W, CY);
  pos = { x: CX - bwc / 2, y: CY + 4, h: BC };
  place();
  await move(0, -(BC * 0.68 + 4), 650, { easing: 'cubic-bezier(.2,1.4,.5,1)' });
  const wave = loop(armR, [{ transform: 'rotate(-70deg)' }, { transform: 'rotate(-105deg)' }], 380);
  await askBubble(CX, CY, BC, bwc);
  wave.cancel();
  api.done();

  // 6. back down the center portal, out of the taskbar portal
  await move(0, BC * 0.68 + 6, 420, { easing: 'cubic-bezier(.5,0,1,1)' });
  closePortal(cp);
  setHole(0, 0, W, T);
  pos = { x: tp.cx - bw / 2, y: T + 4, h: B };
  place();
  await move(0, -(B + 4), 550, { easing: 'cubic-bezier(.2,1.5,.5,1)' });
  await squash();
  closePortal(tp);

  // 7. walk home, grab the edge and climb down behind the taskbar
  await move(BUDDY_X - pos.x, 0, 700, { walk: true });
  await armsTo(1.2, 300);
  for (let i = 0; i < 3; i++) { await move(0, B * 0.3, 380, { easing: 'ease-out' }); await sleep(160); }
  await move(0, B * 0.2 + 8, 250);

  // back to being a drawing
  resetParts();
  idlePose();
  await to(buddy, [{ opacity: 0 }, { opacity: 1 }], 700);
  buddy.getAnimations().forEach((a) => a.cancel());
  busy = false;
  if (pendingLayout) { applyLayout(pendingLayout); pendingLayout = null; }
}

api.onLayout((l) => (busy ? (pendingLayout = l) : applyLayout(l)));
api.onRemind(() => { if (!busy && L) remind(); });
