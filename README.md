# BlockCraft

A mobile-first voxel sandbox in the spirit of Minecraft, written in plain
HTML + JavaScript (three.js for rendering). No build step, no server, no
dependencies to install — open `index.html` and play.

## Features

- **Infinite procedurally generated terrain** — rolling hills, mountains,
  oceans, sandy beaches, and trees, streamed in 16×16 chunks around you
- **Mine & build** — 8 placeable block types on a Minecraft-PE-style hotbar
- **Touch controls** — floating joystick to walk, drag to look, jump/swim
  button, tap to place, press-and-hold to mine (auto-jump included)
- **Desktop controls** — WASD + mouse-look (click to lock pointer),
  left-click mine, right-click place, 1–8 / scroll to pick blocks
- **Day/night cycle**, distance fog, swimmable water with underwater fog
- **Persistent worlds** — edits, position, and seed auto-save to
  `localStorage`; continue where you left off
- **Original procedurally painted textures** — no copyrighted assets

## Play it

**Locally:**

```bash
python3 -m http.server 8000
# then open http://localhost:8000 (module scripts need http://, not file://)
```

**On your phone (GitHub Pages):** repo Settings → Pages → deploy from the
default branch, then open the Pages URL on your phone. Add it to your home
screen for fullscreen play.

## Controls

| Action | Mobile | Desktop |
| --- | --- | --- |
| Walk | left-side joystick | WASD |
| Look | drag anywhere else | mouse (click canvas first) |
| Jump / swim up | round button, bottom-right | Space |
| Mine a block | press & hold on it | hold left-click |
| Place a block | tap | right-click |
| Pick a block | tap the hotbar | 1–8 or scroll wheel |

## Tech notes

- `game.js` — the whole engine: seeded value-noise terrain, chunk meshing
  with hidden-face culling, AABB physics, Amanatides–Woo voxel raycasting,
  canvas-painted texture atlas
- `three.module.min.js` — vendored three.js r160, so the game works fully
  offline
- World height 64, sea level 22, render distance 3 chunks on mobile /
  5 on desktop

## Roadmap ideas

- Crafting and an inventory beyond the hotbar
- Flowing water, caves, ores
- Mobs and survival health/hunger
- Multiplayer via WebRTC

---

*BlockCraft is an original fan-style voxel game and is not affiliated with
Mojang or Microsoft.*
