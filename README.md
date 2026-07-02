# BlockKart + BlockCraft

Two Minecraft-style games in plain HTML + JavaScript (three.js for
rendering). No build step, no server — static files, playable on phones.

## 🏁 BlockKart (`index.html`) — the main game

Blocky kart racing on procedurally generated voxel circuits.

- **Procedural race tracks** — every seed is a new closed circuit with
  elevation changes, carved through hills, beaches, and forests
- **Arcade kart physics** — auto-throttle, steer, brake/reverse, wall
  bounces, off-road slowdown, cyan **boost strips**
- **A real race** — 3 AI karts, 3 laps, 8 checkpoints, live position
  (1st–4th), lap timer, best-lap record saved locally, wrong-way warning
- **Racing furniture** — asphalt with dashed center line, red/white curbs,
  checkered start gate, live minimap
- **Touch controls** — ◀ ▶ steer buttons, BRAKE button, ↺ reset-to-track;
  desktop: arrows/WASD, R to reset

## 🧱 BlockCraft (`sandbox.html`) — sandbox mode

The original mine-and-build voxel sandbox: infinite terrain, 8 block
types, day/night, water, tap-to-place / hold-to-mine touch controls, and
worlds that auto-save to localStorage. Linked from the racing menu.

## Play it

**Locally:**

```bash
python3 -m http.server 8000
# open http://localhost:8000 (racing) or /sandbox.html (sandbox)
```

**On your phone:** enable GitHub Pages (Settings → Pages → deploy from
branch → main /root), then open the Pages URL. Add to home screen for
fullscreen.

## Tech notes

- `race.js` — racing engine: closed Catmull-Rom track spline stamped into
  the voxel terrain, kart physics, spline-following AI, lap/checkpoint
  logic, minimap
- `game.js` — sandbox engine: chunk streaming, AABB physics,
  Amanatides–Woo voxel raycasting
- Both share the same seeded value-noise terrain, chunk mesher with
  hidden-face culling, and a procedurally painted texture atlas
  (no copyrighted assets)
- `three.module.min.js` — vendored three.js r160, fully offline

## Roadmap ideas

- Kart-vs-kart collisions, drifting, items/power-ups
- Track editor built on the sandbox
- Crafting, caves, mobs for sandbox mode
- Multiplayer via WebRTC

---

*Original fan-style games, not affiliated with Mojang or Microsoft.*
