// BlockCraft — a mobile-first voxel sandbox in the spirit of Minecraft.
// Infinite procedural terrain, mining & building, day/night, water, saving.
import * as THREE from 'three';

const errBox = document.getElementById('err');
addEventListener('error', e => { errBox.textContent += (e.message || e.error) + '\n'; });
addEventListener('unhandledrejection', e => { errBox.textContent += e.reason + '\n'; });

/* ================= world constants ================= */
const CHUNK = 16, HEIGHT = 64, SEA = 22;
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5,
      LEAVES = 6, WATER = 7, PLANK = 8, COBBLE = 9, BEDROCK = 10;
// block id -> [top tile, bottom tile, side tile] in the 4x4 atlas
const TILES = {
  [GRASS]: [0, 2, 1], [DIRT]: [2, 2, 2], [STONE]: [3, 3, 3], [SAND]: [4, 4, 4],
  [WOOD]: [6, 6, 5], [LEAVES]: [7, 7, 7], [WATER]: [8, 8, 8], [PLANK]: [9, 9, 9],
  [COBBLE]: [10, 10, 10], [BEDROCK]: [11, 11, 11],
};
const HOTBAR = [GRASS, DIRT, STONE, SAND, WOOD, PLANK, COBBLE, LEAVES];
const isSolid = id => id !== AIR && id !== WATER;

const MOBILE = matchMedia('(pointer: coarse)').matches;
const RENDER_R = MOBILE ? 3 : 5;           // chunk radius
const REACH = 5.5;
const SAVE_KEY = 'blockcraft.v1';

/* ================= seeded noise ================= */
let SEED = (Math.random() * 2 ** 31) | 0;

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

/* ================= terrain generation ================= */
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
  const th = 4 + Math.floor(hash2(x - 9, z + 13) * 2); // trunk height 4-5
  c = { h, sand, tree, th };
  if (colCache.size > 60000) colCache.clear();
  colCache.set(k, c);
  return c;
}

// leaf-shape rule shared by the paste path (genChunk) and query path (genBlock)
function leafAt(dx, dy, dz) { // offsets from trunk top
  if (dy === 1) return Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && !(dx !== 0 && dz !== 0);
  if (dy === 0 || dy === -1)
    return Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && !(Math.abs(dx) === 2 && Math.abs(dz) === 2);
  return false;
}

// single-block query for unloaded terrain (used at chunk borders while meshing)
function genBlock(x, y, z) {
  if (y < 0) return BEDROCK;
  if (y >= HEIGHT) return AIR;
  if (y === 0) return BEDROCK;
  const c = colInfo(x, z);
  if (y <= c.h) {
    if (y === c.h) return c.sand ? SAND : GRASS;
    if (y >= c.h - 3) return c.sand ? SAND : DIRT;
    return STONE;
  }
  if (c.tree && y <= c.h + c.th) return WOOD;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const t = colInfo(x + dx, z + dz);
    if (t.tree && leafAt(-dx, y - (t.h + t.th), -dz)) return LEAVES;
  }
  if (y <= SEA) return WATER;
  return AIR;
}

const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;

/* ================= chunk store ================= */
const chunks = new Map();          // "cx,cz" -> {cx, cz, data, mesh, waterMesh, dirty}
let edits = new Map();             // "cx,cz" -> { localIndex: blockId }
let saveDirty = false;

function genChunk(cx, cz) {
  const data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
    const c = colInfo(x0 + lx, z0 + lz);
    const yMax = Math.max(c.h, SEA);
    for (let y = 0; y <= yMax; y++) {
      let id;
      if (y === 0) id = BEDROCK;
      else if (y <= c.h) {
        if (y === c.h) id = c.sand ? SAND : GRASS;
        else if (y >= c.h - 3) id = c.sand ? SAND : DIRT;
        else id = STONE;
      } else id = WATER;
      data[idx(lx, y, lz)] = id;
    }
  }
  // paste trees whose canopy can reach into this chunk
  const put = (x, y, z, id, force) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
    const i = idx(lx, y, lz);
    if (force || data[i] === AIR) data[i] = id;
  };
  for (let x = x0 - 2; x < x0 + CHUNK + 2; x++) for (let z = z0 - 2; z < z0 + CHUNK + 2; z++) {
    const c = colInfo(x, z);
    if (!c.tree) continue;
    const top = c.h + c.th;
    for (let y = c.h + 1; y <= top; y++) put(x, y, z, WOOD, true);
    for (let dy = -1; dy <= 1; dy++)
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++)
        if (leafAt(ox, dy, oz)) put(x + ox, top + dy, z + oz, LEAVES, false);
  }
  const e = edits.get(cx + ',' + cz);
  if (e) for (const i in e) data[+i] = e[i];
  return data;
}

function getBlock(x, y, z) {
  if (y < 0) return BEDROCK;
  if (y >= HEIGHT) return AIR;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const ch = chunks.get(cx + ',' + cz);
  const i = idx(x - cx * CHUNK, y, z - cz * CHUNK);
  if (ch) return ch.data[i];
  const e = edits.get(cx + ',' + cz);
  if (e && e[i] !== undefined) return e[i];
  return genBlock(x, y, z);
}

function markDirty(cx, cz) {
  const ch = chunks.get(cx + ',' + cz);
  if (ch) ch.dirty = true;
}

function setBlock(x, y, z, id) {
  if (y < 1 || y >= HEIGHT) return false;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const ch = chunks.get(cx + ',' + cz);
  if (!ch) return false;
  const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
  const i = idx(lx, y, lz);
  if (ch.data[i] === id) return false;
  ch.data[i] = id;
  let e = edits.get(cx + ',' + cz);
  if (!e) { e = {}; edits.set(cx + ',' + cz, e); }
  e[i] = id;
  saveDirty = true;
  ch.dirty = true;
  if (lx === 0) markDirty(cx - 1, cz);
  if (lx === CHUNK - 1) markDirty(cx + 1, cz);
  if (lz === 0) markDirty(cx, cz - 1);
  if (lz === CHUNK - 1) markDirty(cx, cz + 1);
  return true;
}

/* ================= texture atlas (original, procedurally painted) ================= */
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
const PAINTERS = [pGrassTop, pGrassSide, pDirt, pStone, pSand, pWoodSide, pWoodTop,
                  pLeaves, pWater, pPlank, pCobble, pBedrock];

function makeAtlasCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  const im = g.createImageData(64, 64);
  for (let t = 0; t < PAINTERS.length; t++) {
    const col = t % 4, row = (t / 4) | 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = hash2(x + t * 97 + 5000, y + t * 131 + 9000);
      const [R, G, B] = PAINTERS[t](x, y, r);
      const i = ((row * 16 + y) * 64 + col * 16 + x) * 4;
      im.data[i] = R; im.data[i + 1] = G; im.data[i + 2] = B; im.data[i + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return cv;
}

/* ================= meshing ================= */
// corners/uv layout follows the classic three.js voxel-geometry arrangement
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
      const tc = t % 4, tr = (t / 4) | 0;
      const shade = f.dir[1] > 0 ? 1.0 : f.dir[1] < 0 ? 0.55 : (f.dir[0] !== 0 ? 0.75 : 0.85);
      const a = isWater ? w : o;
      const base = a.pos.length / 3;
      for (const [p, uv] of f.corners) {
        a.pos.push(lx + p[0], y + (p[1] === 1 ? topY : 0), lz + p[2]);
        a.col.push(shade, shade, shade);
        a.uv.push((tc + uv[0]) / 4, 1 - (tr + 1 - uv[1]) / 4);
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

/* ================= player & physics ================= */
const P_W = 0.3, P_H = 1.8, EYE = 1.62, EPS = 0.001;
const player = { x: 8.5, y: 40, z: 8.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.15, grounded: false };

function spawnPlayer() {
  for (let x = 0; x < 400; x++) {
    const c = colInfo(x, 8);
    if (c.h > SEA + 1 && !c.tree) {
      player.x = x + 0.5; player.z = 8.5; player.y = c.h + 2;
      player.vx = player.vy = player.vz = 0;
      return;
    }
  }
  player.x = 8.5; player.y = 40; player.z = 8.5;
}

function collideAxis(axis, amount) {
  if (amount === 0) return false;
  player[axis] += amount;
  const minX = player.x - P_W, maxX = player.x + P_W;
  const minY = player.y, maxY = player.y + P_H;
  const minZ = player.z - P_W, maxZ = player.z + P_W;
  const x1 = Math.floor(maxX - 1e-7), y1 = Math.floor(maxY - 1e-7), z1 = Math.floor(maxZ - 1e-7);
  for (let bx = Math.floor(minX); bx <= x1; bx++)
    for (let by = Math.floor(minY); by <= y1; by++)
      for (let bz = Math.floor(minZ); bz <= z1; bz++) {
        if (!isSolid(getBlock(bx, by, bz))) continue;
        if (axis === 'x') player.x = amount > 0 ? bx - P_W - EPS : bx + 1 + P_W + EPS;
        else if (axis === 'z') player.z = amount > 0 ? bz - P_W - EPS : bz + 1 + P_W + EPS;
        else {
          if (amount > 0) player.y = by - P_H - EPS;
          else { player.y = by + 1 + EPS; player.grounded = true; }
        }
        return true;
      }
  return false;
}

const input = { mx: 0, mz: 0, jump: false };   // mx: strafe, mz: forward (each -1..1)

function stepPhysics(dt) {
  const feetIn = getBlock(Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)) === WATER;
  const headIn = getBlock(Math.floor(player.x), Math.floor(player.y + 1.4), Math.floor(player.z)) === WATER;
  const speed = feetIn ? 3.0 : 4.3;

  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const dx = (-sy * input.mz + cy * input.mx) * speed;
  const dz = (-cy * input.mz - sy * input.mx) * speed;
  const k = Math.min(1, dt * 12);
  player.vx += (dx - player.vx) * k;
  player.vz += (dz - player.vz) * k;

  if (feetIn || headIn) {
    player.vy -= 6 * dt;
    player.vy = Math.max(player.vy, -3.2);
    if (input.jump) player.vy = Math.min(player.vy + 36 * dt, 3.4);
  } else {
    player.vy -= 24 * dt;
    if (input.jump && player.grounded) player.vy = 8.2;
  }
  player.vy = Math.max(player.vy, -48);

  player.grounded = false;
  if (collideAxis('y', player.vy * dt)) player.vy = 0;
  const hitX = collideAxis('x', player.vx * dt);
  const hitZ = collideAxis('z', player.vz * dt);
  if (hitX) player.vx = 0;
  if (hitZ) player.vz = 0;
  // MCPE-style auto-jump when walking into a ledge
  if ((hitX || hitZ) && player.grounded && !feetIn && (input.mx || input.mz)) player.vy = 8.2;

  if (player.y < -8) spawnPlayer();
  return headIn;
}

/* ================= voxel raycast (Amanatides & Woo) ================= */
function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
  let ix = Math.floor(ox), iy = Math.floor(oy), iz = Math.floor(oz);
  const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
  const dtx = Math.abs(1 / dx), dty = Math.abs(1 / dy), dtz = Math.abs(1 / dz);
  let tx = dx !== 0 ? dtx * (dx > 0 ? ix + 1 - ox : ox - ix) : Infinity;
  let ty = dy !== 0 ? dty * (dy > 0 ? iy + 1 - oy : oy - iy) : Infinity;
  let tz = dz !== 0 ? dtz * (dz > 0 ? iz + 1 - oz : oz - iz) : Infinity;
  let t = 0, nx = 0, ny = 0, nz = 0;
  while (t <= maxDist) {
    const b = getBlock(ix, iy, iz);
    if (isSolid(b)) return { x: ix, y: iy, z: iz, nx, ny, nz, block: b };
    if (tx < ty && tx < tz) { ix += stx; t = tx; tx += dtx; nx = -stx; ny = 0; nz = 0; }
    else if (ty < tz)       { iy += sty; t = ty; ty += dty; nx = 0; ny = -sty; nz = 0; }
    else                    { iz += stz; t = tz; tz += dtz; nx = 0; ny = 0; nz = -stz; }
  }
  return null;
}

/* ================= three.js setup ================= */
const canvas = document.getElementById('game');
let renderer, camera, atlasTex;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
} catch (e) {
  errBox.textContent = 'WebGL is not available on this device: ' + e.message;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
scene = new THREE.Scene();
camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.rotation.order = 'YXZ';
scene.fog = new THREE.Fog(0x87b9ec, 20, RENDER_R * CHUNK);

const atlasCanvas = makeAtlasCanvas();
atlasTex = new THREE.CanvasTexture(atlasCanvas);
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
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ================= chunk streaming ================= */
function updateChunks() {
  const pcx = Math.floor(player.x / CHUNK), pcz = Math.floor(player.z / CHUNK);
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
    markDirty(cx - 1, cz); markDirty(cx + 1, cz); markDirty(cx, cz - 1); markDirty(cx, cz + 1);
  }
  let rebuilt = 0;
  for (const ch of chunks.values()) {
    if (ch.dirty && rebuilt < 4) { buildChunkMesh(ch); rebuilt++; }
    if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > RENDER_R + 1) {
      disposeChunkMeshes(ch);
      chunks.delete(ch.cx + ',' + ch.cz);
    }
  }
}

/* ================= interaction ================= */
let selected = 0;

function rayFromScreen(sx, sy) {
  const v = new THREE.Vector3((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5);
  v.unproject(camera).sub(camera.position).normalize();
  return v;
}
function rayFromCenter() {
  return camera.getWorldDirection(new THREE.Vector3());
}
function intersectsPlayer(bx, by, bz) {
  return bx + 1 > player.x - P_W && bx < player.x + P_W &&
         by + 1 > player.y && by < player.y + P_H &&
         bz + 1 > player.z - P_W && bz < player.z + P_W;
}
function doBreak(dir) {
  const h = raycast(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
  if (h && h.block !== BEDROCK) setBlock(h.x, h.y, h.z, AIR);
}
function doPlace(dir) {
  const h = raycast(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
  if (!h) return;
  const bx = h.x + h.nx, by = h.y + h.ny, bz = h.z + h.nz;
  const cur = getBlock(bx, by, bz);
  if ((cur === AIR || cur === WATER) && !intersectsPlayer(bx, by, bz))
    setBlock(bx, by, bz, HOTBAR[selected]);
}

/* ---------- touch controls ---------- */
const joyEl = document.getElementById('joy');
const knobEl = document.getElementById('joy-knob');
const jumpEl = document.getElementById('jump');
const ringEl = document.getElementById('ring');
const touchState = new Map();
let joyTouchId = null, joyBase = null;

const LOOK_SENS = 0.006, HOLD_MS = 320, BREAK_REPEAT_MS = 360, TAP_MS = 300, TAP_SLOP = 12;

function showRing(x, y) { ringEl.style.display = 'block'; ringEl.style.left = x + 'px'; ringEl.style.top = y + 'px'; }
function hideRing() { ringEl.style.display = 'none'; }

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (!started) return;
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    if (joyTouchId === null && x < innerWidth * 0.4 && y > innerHeight * 0.4) {
      joyTouchId = t.identifier;
      joyBase = { x, y };
      joyEl.style.display = 'block';
      joyEl.style.left = (x - 60) + 'px';
      joyEl.style.top = (y - 60) + 'px';
      knobEl.style.transform = 'translate(-50%,-50%)';
      continue;
    }
    const st = { x, y, sx: x, sy: y, t0: performance.now(), moved: false, breaking: false, timer: 0, rep: 0 };
    st.timer = setTimeout(() => {
      st.breaking = true;
      showRing(st.x, st.y);
      doBreak(rayFromScreen(st.x, st.y));
      st.rep = setInterval(() => doBreak(rayFromScreen(st.x, st.y)), BREAK_REPEAT_MS);
    }, HOLD_MS);
    touchState.set(t.identifier, st);
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      let dx = (t.clientX - joyBase.x) / 45, dy = (t.clientY - joyBase.y) / 45;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      input.mx = dx; input.mz = -dy;
      knobEl.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
      continue;
    }
    const st = touchState.get(t.identifier);
    if (!st) continue;
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    st.x = t.clientX; st.y = t.clientY;
    player.yaw -= dx * LOOK_SENS;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * LOOK_SENS));
    if (Math.hypot(t.clientX - st.sx, t.clientY - st.sy) > TAP_SLOP) {
      st.moved = true;
      if (!st.breaking) clearTimeout(st.timer);
    }
    if (st.breaking) showRing(st.x, st.y);
  }
}, { passive: false });

function endTouch(e, cancelled) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      joyTouchId = null;
      input.mx = input.mz = 0;
      joyEl.style.display = 'none';
      continue;
    }
    const st = touchState.get(t.identifier);
    if (!st) continue;
    clearTimeout(st.timer);
    clearInterval(st.rep);
    if (st.breaking) hideRing();
    else if (!cancelled && !st.moved && performance.now() - st.t0 < TAP_MS && started)
      doPlace(rayFromScreen(t.clientX, t.clientY));
    touchState.delete(t.identifier);
  }
}
canvas.addEventListener('touchend', e => endTouch(e, false), { passive: false });
canvas.addEventListener('touchcancel', e => endTouch(e, true), { passive: false });

jumpEl.addEventListener('pointerdown', e => { e.preventDefault(); input.jump = true; jumpEl.classList.add('on'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
  jumpEl.addEventListener(ev, () => { input.jump = false; jumpEl.classList.remove('on'); });

document.addEventListener('touchmove', e => {
  if (!e.target.closest('#menu')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- keyboard & mouse (desktop) ---------- */
const keys = new Set();
let mouseRep = 0;
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5) - 1;
    if (n >= 0 && n < HOTBAR.length) selectSlot(n);
  }
  syncKeys();
});
addEventListener('keyup', e => { keys.delete(e.code); syncKeys(); });
function syncKeys() {
  if (MOBILE && joyTouchId !== null) return;
  input.mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  input.mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  input.jump = keys.has('Space');
}
addEventListener('wheel', e => selectSlot((selected + (e.deltaY > 0 ? 1 : HOTBAR.length - 1)) % HOTBAR.length));

canvas.addEventListener('mousedown', e => {
  if (!started || MOBILE) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) {
    doBreak(rayFromCenter());
    clearInterval(mouseRep);
    mouseRep = setInterval(() => doBreak(rayFromCenter()), BREAK_REPEAT_MS);
  } else if (e.button === 2) doPlace(rayFromCenter());
});
addEventListener('mouseup', () => clearInterval(mouseRep));
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0025));
});

/* ================= hotbar UI ================= */
const hotbarEl = document.getElementById('hotbar');
const slotEls = [];

function tileCanvas(t) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  c.getContext('2d').drawImage(atlasCanvas, (t % 4) * 16, ((t / 4) | 0) * 16, 16, 16, 0, 0, 16, 16);
  return c;
}
function drawIcon(cv, id) {
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 48, 48);
  const top = tileCanvas(TILES[id][0]), side = tileCanvas(TILES[id][2]);
  const S = 0.5625, H = 0.28125;
  g.setTransform(S, H, -S, H, 24, 13); g.drawImage(top, 0, 0);          // top face
  g.setTransform(S, H, 0, 1.125, 15, 17.5); g.drawImage(side, 0, 0);    // left face
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 16, 16);
  g.setTransform(S, -H, 0, 1.125, 24, 22); g.drawImage(side, 0, 0);     // right face
  g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 0, 16, 16);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
function selectSlot(i) {
  selected = i;
  slotEls.forEach((s, j) => s.classList.toggle('sel', j === i));
  saveDirty = true;
}
for (let i = 0; i < HOTBAR.length; i++) {
  const cv = document.createElement('canvas');
  cv.width = 48; cv.height = 48;
  drawIcon(cv, HOTBAR[i]);
  cv.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); selectSlot(i); }, { passive: false });
  cv.addEventListener('mousedown', e => { e.stopPropagation(); selectSlot(i); });
  hotbarEl.appendChild(cv);
  slotEls.push(cv);
}

/* ================= save / load ================= */
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      seed: SEED,
      edits: Object.fromEntries(edits),
      player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
      sel: selected,
    }));
    saveDirty = false;
  } catch (e) { /* storage full or blocked — keep playing */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    SEED = s.seed;
    colCache.clear();
    edits = new Map(Object.entries(s.edits || {}));
    Object.assign(player, s.player);
    player.vx = player.vy = player.vz = 0;
    selectSlot(s.sel || 0);
    return true;
  } catch (e) { return false; }
}
setInterval(() => { if (saveDirty && started) saveGame(); }, 4000);
addEventListener('pagehide', () => { if (started) saveGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && started) saveGame(); });

/* ================= menu ================= */
const menuEl = document.getElementById('menu');
const btnPlay = document.getElementById('btn-play');
const btnNew = document.getElementById('btn-new');
let started = false;

const hasSave = loadGame();
if (!hasSave) spawnPlayer();
btnPlay.textContent = hasSave ? 'Continue' : 'Play';

btnPlay.addEventListener('click', () => { started = true; menuEl.classList.add('hidden'); });
btnNew.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  SEED = (Math.random() * 2 ** 31) | 0;
  colCache.clear();
  edits = new Map();
  for (const ch of chunks.values()) disposeChunkMeshes(ch);
  chunks.clear();
  spawnPlayer();
  player.yaw = 0; player.pitch = -0.15;
  started = true;
  menuEl.classList.add('hidden');
  saveDirty = true;
});
document.getElementById('pause').addEventListener('click', () => {
  saveGame();
  btnPlay.textContent = 'Resume';
  menuEl.classList.remove('hidden');
});

/* ================= main loop ================= */
const debugEl = document.getElementById('debug');
const skyDay = new THREE.Color(0x87b9ec), skyNight = new THREE.Color(0x0a1030);
const skyNow = new THREE.Color();
let timeOfDay = 0.06;   // fraction of a day; day length = 4 min
let last = performance.now(), frames = 0, fps = 0, fpsT = last;

selectSlot(selected);

function animate(now) {
  requestAnimationFrame(animate);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  let headInWater = false;
  if (started) {
    const steps = Math.max(1, Math.ceil(dt / 0.0167));
    for (let i = 0; i < steps; i++) headInWater = stepPhysics(dt / steps);
    timeOfDay = (timeOfDay + dt / 240) % 1;
  }

  updateChunks();

  camera.position.set(player.x, player.y + EYE, player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  const b = Math.max(0.14, Math.min(1, 0.5 + Math.sin(timeOfDay * Math.PI * 2) * 0.7));
  if (headInWater) {
    skyNow.setRGB(0.08 * b, 0.22 * b, 0.45 * b);
    scene.fog.near = 1; scene.fog.far = 16;
  } else {
    skyNow.copy(skyNight).lerp(skyDay, b);
    scene.fog.near = Math.max(12, (RENDER_R - 1.2) * CHUNK);
    scene.fog.far = (RENDER_R + 0.6) * CHUNK;
  }
  scene.fog.color.copy(skyNow);
  renderer.setClearColor(skyNow);
  matOpaque.color.setScalar(b);
  matWater.color.setScalar(b);

  renderer.render(scene, camera);

  frames++;
  if (now - fpsT > 500) {
    fps = Math.round(frames * 1000 / (now - fpsT));
    frames = 0; fpsT = now;
    debugEl.textContent = `${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)} · ${fps} fps`;
  }
}
requestAnimationFrame(animate);

if (location.search.includes('autoplay')) btnPlay.click();

// debug/test hook
window.__game = { player, input, getBlock, setBlock, doBreak, doPlace, rayFromCenter, chunks };
