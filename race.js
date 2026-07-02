// BlockKart — Minecraft-style kart racing on a procedurally generated voxel circuit.
// Shares the visual language and terrain engine of the BlockCraft sandbox (game.js).
import * as THREE from 'three';

const errBox = document.getElementById('err');
addEventListener('error', e => { errBox.textContent += (e.message || e.error) + '\n'; });
addEventListener('unhandledrejection', e => { errBox.textContent += e.reason + '\n'; });

/* ================= constants ================= */
const CHUNK = 16, HEIGHT = 64, SEA = 22;
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5,
      LEAVES = 6, WATER = 7, PLANK = 8, COBBLE = 9, BEDROCK = 10,
      ROAD = 11, MARK = 12, CURB_R = 13, CURB_W = 14, BOOST = 15, CHECKER = 16;
// block id -> [top tile, bottom tile, side tile] in the 4x5 atlas
const TILES = {
  [GRASS]: [0, 2, 1], [DIRT]: [2, 2, 2], [STONE]: [3, 3, 3], [SAND]: [4, 4, 4],
  [WOOD]: [6, 6, 5], [LEAVES]: [7, 7, 7], [WATER]: [8, 8, 8], [PLANK]: [9, 9, 9],
  [COBBLE]: [10, 10, 10], [BEDROCK]: [11, 11, 11],
  [ROAD]: [12, 12, 12], [MARK]: [13, 13, 12], [CURB_R]: [14, 14, 14],
  [CURB_W]: [15, 15, 15], [BOOST]: [16, 16, 12], [CHECKER]: [17, 17, 17],
};
const ATLAS_COLS = 4, ATLAS_ROWS = 5;
const isSolid = id => id !== AIR && id !== WATER;

const MOBILE = matchMedia('(pointer: coarse)').matches;
const RENDER_R = MOBILE ? 4 : 6;
const ROAD_HALF = 3.5, CURB_OUT = 4.5, BLEND_OUT = 16;
const VMAX = 30, LAPS = 3;
const SEED_KEY = 'blockkart.seed', BEST_KEY = 'blockkart.best';

/* ================= seeded noise (same flavor as the sandbox) ================= */
let SEED = +localStorage.getItem(SEED_KEY);
if (!SEED) SEED = (Math.random() * 2 ** 31) | 0;

function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(SEED, 974634617);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  return lerp(
    lerp(hash2(xi, zi), hash2(xi + 1, zi), smooth(xf)),
    lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), smooth(xf)), smooth(zf));
}
function fbm(x, z) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += amp * vnoise(x * f, z * f); f *= 2; amp *= 0.5; }
  return v / 0.9375;
}

let colCache = new Map();
function colInfo(x, z) {
  const k = x + ',' + z;
  let c = colCache.get(k);
  if (c) return c;
  const n = fbm(x * 0.014 + 100, z * 0.014 + 100);
  const m = Math.max(0, fbm(x * 0.004 + 700, z * 0.004 - 300) - 0.58) * 2.4;
  let h = Math.floor(7 + n * 23 + m * m * 40);
  if (h > HEIGHT - 8) h = HEIGHT - 8;
  const sand = h <= SEA + 1;
  const tree = !sand && hash2(x * 3 + 11, z * 3 - 7) < 0.02;
  const th = 4 + Math.floor(hash2(x - 9, z + 13) * 2);
  c = { h, sand, tree, th };
  if (colCache.size > 60000) colCache.clear();
  colCache.set(k, c);
  return c;
}
function leafAt(dx, dy, dz) {
  if (dy === 1) return Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && !(dx !== 0 && dz !== 0);
  if (dy === 0 || dy === -1)
    return Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && !(Math.abs(dx) === 2 && Math.abs(dz) === 2);
  return false;
}

/* ================= track spline ================= */
let track = null; // {pts:[{x,z,h,tx,tz}], len, cum:[], roadMap:Map, gate:Map}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildTrack() {
  const K = 12, ctrl = [];
  for (let i = 0; i < K; i++) {
    const a = (i / K) * Math.PI * 2;
    const r = 75 + hash2(i * 37 + 5, i * 91 - 3) * 55;
    ctrl.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  const pts = [];
  const STEPS = 80;
  for (let i = 0; i < K; i++) {
    const p0 = ctrl[(i + K - 1) % K], p1 = ctrl[i], p2 = ctrl[(i + 1) % K], p3 = ctrl[(i + 2) % K];
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      pts.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  const n = pts.length;
  // gentle elevation, heavily smoothed so the road is drivable
  let hs = pts.map(p => 26 + (fbm(p.x * 0.008 + 50, p.z * 0.008 + 50) - 0.5) * 14);
  for (let pass = 0; pass < 3; pass++) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let w = -12; w <= 12; w++) s += hs[(i + w + n) % n];
      out[i] = s / 25;
    }
    hs = out;
  }
  for (let i = 0; i < n; i++) pts[i].h = Math.max(SEA + 2.5, hs[i]);
  // tangents + cumulative length
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    pts[i].tx = tx / l; pts[i].tz = tz / l;
    if (i > 0) {
      const q = pts[i - 1];
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - q.x, pts[i].z - q.z));
    }
  }
  const len = cum[n - 1] + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);

  // stamp the road footprint into a column map: cell -> {d, h, i}
  const roadMap = new Map();
  for (let i = 0; i < n; i++) {
    const p = pts[i], px = Math.round(p.x), pz = Math.round(p.z);
    for (let dx = -BLEND_OUT; dx <= BLEND_OUT; dx++) for (let dz = -BLEND_OUT; dz <= BLEND_OUT; dz++) {
      if (dx * dx + dz * dz > BLEND_OUT * BLEND_OUT) continue;
      const cx = px + dx, cz = pz + dz;
      const d = Math.hypot(cx - p.x, cz - p.z);
      const key = cx + ',' + cz;
      const e = roadMap.get(key);
      if (!e || d < e.d) roadMap.set(key, { d, h: p.h, i });
    }
  }

  // start/finish gate at sample 0
  const gate = new Map();
  const g = pts[0], px = -g.tz, pz = g.tx, gh = Math.round(g.h);
  for (const side of [-5, 5]) {
    const bx = Math.round(g.x + px * side), bz = Math.round(g.z + pz * side);
    for (let y = gh + 1; y <= gh + 5; y++) gate.set(bx + ',' + y + ',' + bz, PLANK);
  }
  for (let o = -5; o <= 5; o++) {
    const bx = Math.round(g.x + px * o), bz = Math.round(g.z + pz * o);
    gate.set(bx + ',' + (gh + 5) + ',' + bz, CHECKER);
  }
  track = { pts, n, len, cum, roadMap, gate };
}

/* ================= column surface (terrain + road blended) ================= */
let surfCache = new Map();
function columnSurface(x, z) {
  const k = x + ',' + z;
  let s = surfCache.get(k);
  if (s) return s;
  const e = track.roadMap.get(k);
  const terr = colInfo(x, z);
  if (e && e.d <= CURB_OUT) {
    const h = Math.round(e.h);
    let id;
    if (e.d > ROAD_HALF) id = ((e.i >> 2) & 1) ? CURB_R : CURB_W;
    else if (e.d <= 2.5 && (e.i % 240) < 8 && e.i > 20) id = BOOST;
    else if (e.d < 0.7 && (e.i % 14) < 7) id = MARK;
    else id = ROAD;
    s = { h, id, tree: false };
  } else if (e) {
    const t = smooth(Math.min(1, (e.d - CURB_OUT) / (BLEND_OUT - CURB_OUT - 1)));
    const h = Math.round(lerp(e.h, terr.h, t));
    s = { h, id: h <= SEA + 1 ? SAND : GRASS, tree: terr.tree && e.d > 9, th: terr.th };
  } else {
    s = { h: terr.h, id: terr.sand ? SAND : GRASS, tree: terr.tree, th: terr.th };
  }
  if (surfCache.size > 60000) surfCache.clear();
  surfCache.set(k, s);
  return s;
}

/* ================= chunks ================= */
const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;
const chunks = new Map();

function genChunk(cx, cz) {
  const data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
    const s = columnSurface(x0 + lx, z0 + lz);
    const yMax = Math.max(s.h, SEA);
    for (let y = 0; y <= yMax; y++) {
      let id;
      if (y === 0) id = BEDROCK;
      else if (y <= s.h) {
        if (y === s.h) id = s.id;
        else if (y >= s.h - 3) id = (s.id === SAND ? SAND : DIRT);
        else id = STONE;
      } else id = WATER;
      data[idx(lx, y, lz)] = id;
    }
  }
  const put = (x, y, z, id, force) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
    const i = idx(lx, y, lz);
    if (force || data[i] === AIR) data[i] = id;
  };
  for (let x = x0 - 2; x < x0 + CHUNK + 2; x++) for (let z = z0 - 2; z < z0 + CHUNK + 2; z++) {
    const s = columnSurface(x, z);
    if (!s.tree) continue;
    const top = s.h + s.th;
    for (let y = s.h + 1; y <= top; y++) put(x, y, z, WOOD, true);
    for (let dy = -1; dy <= 1; dy++)
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++)
        if (leafAt(ox, dy, oz)) put(x + ox, top + dy, z + oz, LEAVES, false);
  }
  for (const [key, id] of track.gate) {
    const [x, y, z] = key.split(',').map(Number);
    put(x, y, z, id, true);
  }
  return data;
}

function getBlock(x, y, z) {
  if (y < 0) return BEDROCK;
  if (y >= HEIGHT) return AIR;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const ch = chunks.get(cx + ',' + cz);
  if (ch) return ch.data[idx(x - cx * CHUNK, y, z - cz * CHUNK)];
  // fall back to generation-consistent single query
  const s = columnSurface(x, z);
  if (y <= s.h) {
    if (y === 0) return BEDROCK;
    if (y === s.h) return s.id;
    if (y >= s.h - 3) return s.id === SAND ? SAND : DIRT;
    return STONE;
  }
  const g = track.gate.get(x + ',' + y + ',' + z);
  if (g) return g;
  if (s.tree && y <= s.h + s.th) return WOOD;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const t = columnSurface(x + dx, z + dz);
    if (t.tree && leafAt(-dx, y - (t.h + t.th), -dz)) return LEAVES;
  }
  if (y <= SEA) return WATER;
  return AIR;
}

/* ================= texture atlas ================= */
const clamp255 = v => Math.max(0, Math.min(255, v | 0));
const vary = (b, r, a) => clamp255(b + (r - 0.5) * a);
const pGrassTop = (x, y, r) => [vary(98, r, 46), vary(162, r, 56), vary(66, r, 38)];
const pDirt = (x, y, r) => [vary(136, r, 40), vary(98, r, 34), vary(68, r, 28)];
const pGrassSide = (x, y, r) => (y < 3 || (y === 3 && r < 0.5)) ? pGrassTop(x, y, r) : pDirt(x, y, r);
const pStone = (x, y, r) => { const g = vary(r < 0.12 ? 102 : 130, r, 34); return [g, g, clamp255(g * 1.03)]; };
const pSand = (x, y, r) => [vary(220, r, 24), vary(208, r, 24), vary(162, r, 26)];
const pWoodSide = (x, y, r) => {
  const d = ((x + ((y / 8) | 0)) % 4 === 0) || r < 0.08;
  return [vary(d ? 82 : 112, r, 20), vary(d ? 60 : 85, r, 16), vary(d ? 36 : 51, r, 14)];
};
const pWoodTop = (x, y, r) => {
  const ring = ((Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) | 0) % 2) === 0;
  return [vary(ring ? 172 : 132, r, 22), vary(ring ? 138 : 102, r, 18), vary(ring ? 88 : 62, r, 14)];
};
const pLeaves = (x, y, r) => {
  const d = r < 0.25;
  return [vary(d ? 38 : 58, r, 24), vary(d ? 92 : 132, r, 32), vary(d ? 30 : 44, r, 20)];
};
const pWater = (x, y, r) => {
  const l = r < 0.1;
  return [vary(l ? 84 : 48, r, 14), vary(l ? 142 : 106, r, 18), vary(l ? 224 : 198, r, 20)];
};
const pPlank = (x, y, r) => {
  const d = (y % 4 === 3) || ((x + ((y / 4) | 0) * 8) % 16 === 7);
  return [vary(d ? 120 : 176, r, 22), vary(d ? 90 : 139, r, 20), vary(d ? 54 : 85, r, 16)];
};
const pCobble = (x, y, r) => {
  const edge = x % 4 === 0 || y % 4 === 0;
  const c = hash2(((x >> 2) + 31) * 7, ((y >> 2) + 57) * 13);
  const g = edge ? vary(86, r, 18) : vary(108 + c * 46, r, 20);
  return [g, g, clamp255(g * 1.02)];
};
const pBedrock = (x, y, r) => { const g = r < 0.4 ? vary(44, r, 20) : vary(82, r, 26); return [g, g, clamp255(g + 4)]; };
const pAsphalt = (x, y, r) => { const g = r < 0.06 ? vary(92, r, 16) : vary(58, r, 16); return [g, g, clamp255(g + 3)]; };
const pMark = (x, y, r) => { const g = vary(232, r, 20); return [g, g, vary(214, r, 20)]; };
const pCurbR = (x, y, r) => [vary(198, r, 30), vary(46, r, 20), vary(42, r, 20)];
const pCurbW = (x, y, r) => { const g = vary(224, r, 22); return [g, g, g]; };
const pBoost = (x, y, r) => {
  const ch = ((x + y) & 7) < 2;
  return [vary(ch ? 16 : 44, r, 16), vary(ch ? 140 : 205, r, 26), vary(ch ? 160 : 224, r, 26)];
};
const pChecker = (x, y, r) => { const w = (((x >> 2) + (y >> 2)) & 1) === 0; const g = w ? vary(235, r, 16) : vary(26, r, 14); return [g, g, g]; };
const PAINTERS = [pGrassTop, pGrassSide, pDirt, pStone, pSand, pWoodSide, pWoodTop,
                  pLeaves, pWater, pPlank, pCobble, pBedrock,
                  pAsphalt, pMark, pCurbR, pCurbW, pBoost, pChecker];

function makeAtlasCanvas() {
  const cv = document.createElement('canvas');
  cv.width = ATLAS_COLS * 16; cv.height = ATLAS_ROWS * 16;
  const g = cv.getContext('2d');
  const im = g.createImageData(cv.width, cv.height);
  for (let t = 0; t < PAINTERS.length; t++) {
    const col = t % ATLAS_COLS, row = (t / ATLAS_COLS) | 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = hash2(x + t * 97 + 5000, y + t * 131 + 9000);
      const [R, G, B] = PAINTERS[t](x, y, r);
      const i = ((row * 16 + y) * cv.width + col * 16 + x) * 4;
      im.data[i] = R; im.data[i + 1] = G; im.data[i + 2] = B; im.data[i + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return cv;
}

/* ================= meshing ================= */
const FACES = [
  { dir: [-1, 0, 0], corners: [[[0,1,0],[0,1]], [[0,0,0],[0,0]], [[0,1,1],[1,1]], [[0,0,1],[1,0]]] },
  { dir: [ 1, 0, 0], corners: [[[1,1,1],[0,1]], [[1,0,1],[0,0]], [[1,1,0],[1,1]], [[1,0,0],[1,0]]] },
  { dir: [ 0,-1, 0], corners: [[[1,0,1],[1,0]], [[0,0,1],[0,0]], [[1,0,0],[1,1]], [[0,0,0],[0,1]]] },
  { dir: [ 0, 1, 0], corners: [[[0,1,1],[1,1]], [[1,1,1],[0,1]], [[0,1,0],[1,0]], [[1,1,0],[0,0]]] },
  { dir: [ 0, 0,-1], corners: [[[1,0,0],[0,0]], [[0,0,0],[1,0]], [[1,1,0],[0,1]], [[0,1,0],[1,1]]] },
  { dir: [ 0, 0, 1], corners: [[[0,0,1],[0,0]], [[1,0,1],[1,0]], [[0,1,1],[0,1]], [[1,1,1],[1,1]]] },
];

let matOpaque, matWater, scene;

function buildChunkMesh(ch) {
  const { cx, cz, data } = ch;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const o = { pos: [], col: [], uv: [], ind: [] };
  const w = { pos: [], col: [], uv: [], ind: [] };
  for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const id = data[idx(lx, y, lz)];
    if (id === AIR) continue;
    const isWater = id === WATER;
    let topY = 1;
    if (isWater) {
      const above = y + 1 >= HEIGHT ? AIR : data[idx(lx, y + 1, lz)];
      if (above === AIR) topY = 0.875;
    }
    for (const f of FACES) {
      const nx = lx + f.dir[0], ny = y + f.dir[1], nz = lz + f.dir[2];
      let nb;
      if (nx >= 0 && nx < CHUNK && nz >= 0 && nz < CHUNK && ny >= 0 && ny < HEIGHT)
        nb = data[idx(nx, ny, nz)];
      else nb = getBlock(x0 + nx, ny, z0 + nz);
      const visible = isWater ? nb === AIR : (nb === AIR || nb === WATER);
      if (!visible) continue;
      const t = TILES[id][f.dir[1] > 0 ? 0 : f.dir[1] < 0 ? 1 : 2];
      const tc = t % ATLAS_COLS, tr = (t / ATLAS_COLS) | 0;
      const shade = f.dir[1] > 0 ? 1.0 : f.dir[1] < 0 ? 0.55 : (f.dir[0] !== 0 ? 0.75 : 0.85);
      const a = isWater ? w : o;
      const base = a.pos.length / 3;
      for (const [p, uv] of f.corners) {
        a.pos.push(lx + p[0], y + (p[1] === 1 ? topY : 0), lz + p[2]);
        a.col.push(shade, shade, shade);
        a.uv.push((tc + uv[0]) / ATLAS_COLS, 1 - (tr + 1 - uv[1]) / ATLAS_ROWS);
      }
      a.ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  disposeChunkMeshes(ch);
  ch.mesh = makeMesh(o, matOpaque, x0, z0, 0);
  ch.waterMesh = makeMesh(w, matWater, x0, z0, 1);
  ch.dirty = false;
}

function makeMesh(a, mat, x0, z0, order) {
  if (!a.ind.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setIndex(a.ind);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x0, 0, z0);
  m.renderOrder = order;
  scene.add(m);
  return m;
}
function disposeChunkMeshes(ch) {
  for (const k of ['mesh', 'waterMesh']) {
    if (ch[k]) { scene.remove(ch[k]); ch[k].geometry.dispose(); ch[k] = null; }
  }
}

/* ================= renderer ================= */
const canvas = document.getElementById('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
} catch (e) {
  errBox.textContent = 'WebGL is not available on this device: ' + e.message;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
scene.fog = new THREE.Fog(0x87b9ec, 20, RENDER_R * CHUNK);

const atlasTex = new THREE.CanvasTexture(makeAtlasCanvas());
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;
atlasTex.colorSpace = THREE.SRGBColorSpace;
matOpaque = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
matWater = new THREE.MeshBasicMaterial({
  map: atlasTex, vertexColors: true, transparent: true, opacity: 0.72,
  depthWrite: false, side: THREE.DoubleSide,
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ================= kart models ================= */
function shadedBox(w, h, d, hex) {
  const c = new THREE.Color(hex);
  const mats = [0.75, 0.75, 1.0, 0.5, 0.85, 0.85].map(s =>
    new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(s) }));
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
}
function makeKart(hex) {
  const g = new THREE.Group();
  const body = shadedBox(1.5, 0.55, 2.5, hex); body.position.y = 0.65; g.add(body);
  const seat = shadedBox(1.0, 0.55, 1.0, 0x333333); seat.position.set(0, 1.15, 0.35); g.add(seat);
  const head = shadedBox(0.62, 0.62, 0.62, 0xd9a066); head.position.set(0, 1.75, 0.35); g.add(head);
  const hat = shadedBox(0.68, 0.25, 0.68, hex); hat.position.set(0, 2.1, 0.35); g.add(hat);
  for (const [x, z] of [[-0.85, 0.9], [0.85, 0.9], [-0.85, -0.9], [0.85, -0.9]]) {
    const wh = shadedBox(0.35, 0.62, 0.62, 0x1c1c1c); wh.position.set(x, 0.31, z); g.add(wh);
  }
  scene.add(g);
  return g;
}

/* ================= race state ================= */
const input = { steer: 0, brake: false };
const car = { x: 0, y: 27, z: 0, th: 0, v: 0, boostT: 0, pIdx: 0, lap: 1, cpNext: 1, wrongT: 0 };
let ai = [];
let state = 'menu';           // menu | count | race | finished
let countT = 0, raceT0 = 0, raceTime = 0, lapT0 = 0, lapTimes = [];
let camYaw = 0;

const CP_COUNT = 8;
function cpTarget(k) { return Math.round((k % CP_COUNT) * track.n / CP_COUNT); }
const circDiff = (a, b, n) => { let d = a - b; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d; };

function placeKarts() {
  const s0 = 6;
  const p = track.pts[s0], px = -p.tz, pz = p.tx;
  car.x = p.x + px * 1.8; car.z = p.z + pz * 1.8;
  car.y = columnSurface(Math.floor(car.x), Math.floor(car.z)).h + 1;
  car.th = Math.atan2(p.tx, p.tz);
  car.v = 0; car.boostT = 0; car.pIdx = s0; car.lap = 1; car.cpNext = 1; car.wrongT = 0;
  camYaw = car.th;
  const colors = [0x2f6fd8, 0xe8c53a, 0x9c4fd8];
  ai.forEach(a => scene.remove(a.mesh));
  ai = colors.map((hex, j) => {
    const off = [-1.8, 1.8, 0][j];
    const backIdx = (s0 - 4 - j * 4 + track.n) % track.n;
    const s = track.cum[backIdx];
    return {
      mesh: makeKart(hex),
      s, total: 0, off,
      start: s > track.len / 2 ? s - track.len : s, // signed arc offset from the finish line
      speed: VMAX * [0.82, 0.88, 0.94][j],
      idx: backIdx,
    };
  });
}

const playerKart = makeKart(0xd83a3a);

function arcToIdx(s, hint) {
  const n = track.n;
  let i = hint;
  s = ((s % track.len) + track.len) % track.len;
  for (let g = 0; g < n; g++) {
    const ni = (i + 1) % n;
    const a = track.cum[i], b = ni === 0 ? track.len : track.cum[ni];
    if (s >= a && s < b) return { i, f: (s - a) / Math.max(1e-6, b - a) };
    i = ni;
  }
  return { i: 0, f: 0 };
}

function updateAI(dt) {
  for (const a of ai) {
    a.total += a.speed * dt;
    const { i, f } = arcToIdx(a.total + a.s, a.idx);
    a.idx = i;
    const p = track.pts[i], q = track.pts[(i + 1) % track.n];
    const x = lerp(p.x, q.x, f) + -p.tz * a.off;
    const z = lerp(p.z, q.z, f) + p.tx * a.off;
    const gy = columnSurface(Math.floor(x), Math.floor(z)).h + 1;
    a.mesh.position.set(x, lerp(a.mesh.position.y || gy, gy, Math.min(1, dt * 10)), z);
    a.mesh.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
  }
}

function nearestIdx() {
  const n = track.n;
  let best = car.pIdx, bd = Infinity;
  for (let w = -60; w <= 60; w++) {
    const i = (car.pIdx + w + n) % n;
    const p = track.pts[i];
    const d = (p.x - car.x) ** 2 + (p.z - car.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function updateCar(dt) {
  const cellS = columnSurface(Math.floor(car.x), Math.floor(car.z));
  const onRoad = cellS.id === ROAD || cellS.id === MARK || cellS.id === BOOST ||
                 cellS.id === CURB_R || cellS.id === CURB_W;
  if (cellS.id === BOOST) car.boostT = 1.3;
  car.boostT = Math.max(0, car.boostT - dt);

  let target = onRoad ? VMAX : VMAX * 0.35;
  if (car.boostT > 0) target = VMAX * 1.5;
  if (input.brake) target = -7;
  const rate = target > car.v ? (car.boostT > 0 ? 26 : 13) : 30;
  car.v += Math.sign(target - car.v) * Math.min(Math.abs(target - car.v), rate * dt);

  car.th -= input.steer * 2.1 * Math.min(1, Math.abs(car.v) / 9) * dt * Math.sign(car.v || 1);

  const nx = car.x + Math.sin(car.th) * car.v * dt;
  const nz = car.z + Math.cos(car.th) * car.v * dt;
  const ns = columnSurface(Math.floor(nx), Math.floor(nz));
  const gh = ns.h + 1;
  if (gh - car.y > 1.3 || ns.h <= SEA) {
    car.v *= -0.35; // bounce off walls & the ocean's edge
  } else {
    car.x = nx; car.z = nz;
    car.y += (gh - car.y) * Math.min(1, dt * 10);
  }

  // progress, checkpoints, laps
  const prev = car.pIdx;
  car.pIdx = nearestIdx();
  const dIdx = circDiff(car.pIdx, prev, track.n);
  car.wrongT = dIdx < 0 ? car.wrongT + dt : 0;
  const tgt = cpTarget(car.cpNext);
  if (Math.abs(circDiff(car.pIdx, tgt, track.n)) < 14) {
    car.cpNext++;
    if (car.cpNext > CP_COUNT) {         // crossed start/finish with all checkpoints
      car.cpNext = 1;
      lapTimes.push(performance.now() - lapT0);
      lapT0 = performance.now();
      car.lap++;
      if (car.lap > LAPS) finishRace();
    }
  }
}

function playerRank() {
  const mine = (car.lap - 1) * track.len + track.cum[car.pIdx];
  let r = 1;
  for (const a of ai) if (a.start + a.total > mine) r++;
  return r;
}

/* ================= chunk streaming ================= */
function updateChunks() {
  const pcx = Math.floor(car.x / CHUNK), pcz = Math.floor(car.z / CHUNK);
  const missing = [];
  for (let dx = -RENDER_R; dx <= RENDER_R; dx++) for (let dz = -RENDER_R; dz <= RENDER_R; dz++) {
    const cx = pcx + dx, cz = pcz + dz;
    if (!chunks.has(cx + ',' + cz)) missing.push([cx, cz, dx * dx + dz * dz]);
  }
  missing.sort((a, b) => a[2] - b[2]);
  for (let i = 0; i < Math.min(2, missing.length); i++) {
    const [cx, cz] = missing[i];
    const ch = { cx, cz, data: genChunk(cx, cz), mesh: null, waterMesh: null, dirty: false };
    chunks.set(cx + ',' + cz, ch);
    buildChunkMesh(ch);
  }
  for (const ch of chunks.values()) {
    if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > RENDER_R + 1) {
      disposeChunkMeshes(ch);
      chunks.delete(ch.cx + ',' + ch.cz);
    }
  }
}

/* ================= HUD ================= */
const el = id => document.getElementById(id);
const lapEl = el('lap'), timerEl = el('timer'), rankEl = el('rank'), speedoEl = el('speedo'),
      countEl = el('count'), wrongEl = el('wrong'), mapEl = el('map'),
      menuEl = el('menu'), finishEl = el('finish'), ftimesEl = el('ftimes');

function fmtTime(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, t = Math.floor(ms / 100) % 10;
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}
const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';

let mapBase = null, mapScale = 1, mapOff = { x: 0, z: 0 };
function buildMinimap() {
  const c = document.createElement('canvas');
  c.width = c.height = 110;
  const g = c.getContext('2d');
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of track.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  mapScale = 92 / Math.max(maxX - minX, maxZ - minZ);
  mapOff = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4; g.lineCap = 'round'; g.beginPath();
  track.pts.forEach((p, i) => {
    const x = 55 + (p.x - mapOff.x) * mapScale, y = 55 + (p.z - mapOff.z) * mapScale;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.closePath(); g.stroke();
  const s = track.pts[0];
  g.fillStyle = '#fff';
  g.fillRect(53 + (s.x - mapOff.x) * mapScale, 53 + (s.z - mapOff.z) * mapScale, 5, 5);
  mapBase = c;
}
function drawMinimap() {
  const g = mapEl.getContext('2d');
  g.clearRect(0, 0, 110, 110);
  g.drawImage(mapBase, 0, 0);
  for (const a of ai) {
    g.fillStyle = '#' + a.mesh.children[0].material[2].color.getHexString();
    g.beginPath();
    g.arc(55 + (a.mesh.position.x - mapOff.x) * mapScale, 55 + (a.mesh.position.z - mapOff.z) * mapScale, 3, 0, 7);
    g.fill();
  }
  g.fillStyle = '#ff4b4b';
  g.beginPath();
  g.arc(55 + (car.x - mapOff.x) * mapScale, 55 + (car.z - mapOff.z) * mapScale, 4, 0, 7);
  g.fill();
}

/* ================= input ================= */
function bindHold(id, on, off) {
  const b = el(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); on(); });
  for (const ev of ['pointerup', 'pointercancel'])
    b.addEventListener(ev, () => { b.classList.remove('on'); off(); });
}
bindHold('sl', () => input.steer = -1, () => { if (input.steer === -1) input.steer = 0; });
bindHold('sr', () => input.steer = 1, () => { if (input.steer === 1) input.steer = 0; });
bindHold('br', () => input.brake = true, () => input.brake = false);

const keys = new Set();
function syncKeys() {
  const l = keys.has('ArrowLeft') || keys.has('KeyA'), r = keys.has('ArrowRight') || keys.has('KeyD');
  input.steer = (r ? 1 : 0) - (l ? 1 : 0);
  input.brake = keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space');
}
addEventListener('keydown', e => { keys.add(e.code); syncKeys(); });
addEventListener('keyup', e => { keys.delete(e.code); syncKeys(); });

document.addEventListener('touchmove', e => {
  if (!e.target.closest('.overlay')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

/* ================= race flow ================= */
function startRace() {
  placeKarts();
  lapTimes = [];
  state = 'count';
  countT = 3.4;
  menuEl.classList.add('hidden');
  finishEl.classList.add('hidden');
}
function finishRace() {
  state = 'finished';
  raceTime = performance.now() - raceT0;
  const bestLap = Math.min(...lapTimes);
  const prevBest = +localStorage.getItem(BEST_KEY) || Infinity;
  if (bestLap < prevBest) localStorage.setItem(BEST_KEY, bestLap);
  ftimesEl.innerHTML =
    `You finished <b>${ordinal(playerRank())}</b>!<br>` +
    `Total ${fmtTime(raceTime)} &middot; Best lap ${fmtTime(bestLap)}` +
    (bestLap < prevBest ? ' &#11088; new record!' : '');
  finishEl.classList.remove('hidden');
}
function newTrack() {
  SEED = (Math.random() * 2 ** 31) | 0;
  localStorage.setItem(SEED_KEY, SEED);
  colCache.clear(); surfCache.clear();
  for (const ch of chunks.values()) disposeChunkMeshes(ch);
  chunks.clear();
  buildTrack();
  buildMinimap();
  startRace();
}
function resetToTrack() {
  if (state !== 'race') return;
  const p = track.pts[car.pIdx];
  car.x = p.x; car.z = p.z;
  car.y = columnSurface(Math.floor(car.x), Math.floor(car.z)).h + 1;
  car.th = Math.atan2(p.tx, p.tz);
  car.v = 0; car.boostT = 0;
  camYaw = car.th;
}
el('reset').addEventListener('click', resetToTrack);
addEventListener('keydown', e => { if (e.code === 'KeyR') resetToTrack(); });

el('btn-race').addEventListener('click', startRace);
el('btn-again').addEventListener('click', startRace);
el('btn-track').addEventListener('click', newTrack);
el('btn-track2').addEventListener('click', newTrack);
el('pause').addEventListener('click', () => { state = 'menu'; menuEl.classList.remove('hidden'); });

/* ================= boot ================= */
localStorage.setItem(SEED_KEY, SEED);
buildTrack();
buildMinimap();
placeKarts();

const skyDay = new THREE.Color(0x87b9ec);
const skyNow = new THREE.Color();
let last = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === 'count') {
    countT -= dt;
    countEl.style.display = 'block';
    if (countT <= 0) {
      countEl.style.display = 'none';
      state = 'race';
      raceT0 = performance.now();
      lapT0 = raceT0;
    } else countEl.textContent = countT > 3 ? '' : Math.ceil(countT);
  }
  if (state === 'race') {
    const steps = Math.max(1, Math.ceil(dt / 0.0167));
    for (let i = 0; i < steps; i++) { updateCar(dt / steps); if (state !== 'race') break; }
    updateAI(dt);
    timerEl.textContent = fmtTime(performance.now() - raceT0);
    lapEl.textContent = `LAP ${Math.min(car.lap, LAPS)}/${LAPS}`;
    rankEl.textContent = ordinal(playerRank());
    wrongEl.style.display = car.wrongT > 0.9 ? 'block' : 'none';
  }
  if (state === 'finished') updateAI(dt);

  playerKart.position.set(car.x, car.y, car.z);
  playerKart.rotation.y = car.th;
  playerKart.rotation.z = -input.steer * Math.min(1, Math.abs(car.v) / VMAX) * 0.12;

  updateChunks();

  // chase camera
  let dy = car.th - camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  camYaw += dy * Math.min(1, dt * 4.5);
  const back = 7.5, up = 3.4;
  camera.position.set(
    car.x - Math.sin(camYaw) * back,
    car.y + up,
    car.z - Math.cos(camYaw) * back);
  camera.lookAt(car.x + Math.sin(camYaw) * 4, car.y + 1.3, car.z + Math.cos(camYaw) * 4);
  camera.fov = 72 + 18 * Math.max(0, car.v) / VMAX;
  camera.updateProjectionMatrix();

  skyNow.copy(skyDay);
  scene.fog.color.copy(skyNow);
  scene.fog.near = Math.max(24, (RENDER_R - 1.2) * CHUNK);
  scene.fog.far = (RENDER_R + 0.6) * CHUNK;
  renderer.setClearColor(skyNow);

  speedoEl.innerHTML = `${Math.round(Math.abs(car.v) * 3.6)} <small>km/h</small>`;
  drawMinimap();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

if (location.search.includes('autoplay')) startRace();

// debug/test hook
window.__race = { car, ai, input, get state() { return state; }, track: () => track, columnSurface, startRace };
