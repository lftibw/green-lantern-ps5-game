# Will & Fear: a Green Lantern-inspired DualSense game

A first-person "ring-slinger" built in the browser. You draw on the PS5 controller's touchpad, and the ring builds what you drew out of solid green hard light. Recognised doodles (hammer, sword, ladder, cannon, car, wheel…) become detailed constructs; anything else becomes a free-form shape. Constructs are real physics objects. R2 pushes them with your will, and the adaptive trigger stiffens and then trembles when something heavy pushes back.

It uses as much of the DualSense as a Mac can reach: adaptive triggers, HD haptics, speaker, mic, lightbar, player LEDs, mute LED, touchpad, accelerometer and gyro. The story is an original fan concept inspired by HBO's *Lanterns* (2026). Personal, non-commercial project.

## Run it

Requires Node 18+ and **Chrome** (WebHID is Chrome/Edge only). Plug the DualSense in with **USB-C** for the speaker, mic and HD haptics.

```bash
npm install
python3 -I tools/fetch_tex.py   # CC0 textures, ~21 MB (see Assets)
sh tools/fetch_models.sh        # X Bot rig for the Lantern suit (from the three.js examples)
npm run dev                     # then open the printed localhost URL in Chrome
```

**Levels:** Rushville, Nebraska (default) and **Gurugram** (`?level=gurugram`): DLF Cyber City, Cyber Hub, NH-48 and the Rapid Metro from real OpenStreetMap data (`node tools/bake-osm.mjs`; data © OpenStreetMap contributors).

Keyboard and mouse also work: WASD to move, arrows to look, Space to fly, G to draw with the mouse, E for R2, H to throw, N to switch day/night, B to summon the Dread, U to surge with your voice, **T to transform (hold T: power down; or L1+R1 / Z+C for 1 s; or say the oath at full charge)**, V for third person.

**Fear:** the Dread (a yellow smoke wraith) hunts you within 40 m at night. Fear cracks your constructs until they shatter, stiffens R2, quickens a heartbeat in your palms, turns the lightbar yellow and drains colour from the screen. Hold R2 hard for 2 s while afraid (or speak into the mic) to fire a **Will surge**: it throws the Dread back and cuts fear by 0.5, for 15% charge on a 10 s cooldown.

## Tech

- **three.js 0.169** (WebGL2): post-processing (GTAO, bloom, grade) and PBR materials
- **Rapier 0.14** (`@dimforge/rapier3d-compat`): physics
- **dualsense-ts 6.15**: controller I/O over WebHID; haptics are sent as audio to the pad's extra channels
- **@dgreenheck/ez-tree 1.1** (MIT): procedural trees
- Doodle recognition: a tiny CNN trained on Google's **Quick, Draw!** dataset (CC BY 4.0), running in plain JS
- Vite 5 dev server

## Assets (not in git; fetch again)

| Path | What | Get it |
|---|---|---|
| `public/tex/` | PBR textures from [Poly Haven](https://polyhaven.com) (CC0): farm_soil, grass_path_2, distressed_painted_planks, corrugated_iron, green_metal_rust | `python3 -I tools/fetch_tex.py` |
| `public/vo/` | Placeholder voice lines (macOS `say`; currently muted in game) | `npm run voices` |
| `tools/qd/` | Quick, Draw! training bitmaps (first 12k per class) | `python3 -I tools/fetch_qd.py` |
| `public/doodle/` | Trained doodle model (**in git**, 428 KB) | retrain: `tools/.venv/bin/python -I tools/train_doodle.py` (needs numpy + torch in `tools/.venv`) |
| `public/models/` | Mixamo X Bot (three.js examples) | `sh tools/fetch_models.sh` |
| `public/osm/` | Baked Gurugram OSM data (**in git**, 351 KB) | `node tools/bake-osm.mjs` |
| `node_modules/` | npm packages (incl. EZ-Tree's bark/leaf textures) | `npm install` |

## Folder structure

```
index.html        page, HUD, overlays
fear.js           the Dread, fear meter, construct cracking/shatter, heartbeat, Will surge
level.js          ?level=gurugram switch
city/osmcity.js   Gurugram from OSM: tiled merged buildings (glass/plaster shaders), roads, viaducts, metro, trees, lights, vehicles
suit/suit.js      the Lantern: X Bot body + suit shader, first-person suited arms, third-person camera, ring bone
suit/transform.js the transformation sequence (orbit camera, flare, suit growth, mask, shockwave) and power-down
main.js           game loop, ring charge, drawing → construct, oath, haptics/audio, HUD
pad.js            DualSense I/O: input, triggers, LEDs, haptics-as-audio, mic, gyro, thrust
gfx.js            renderer, sky, lights, fog, post-processing, quality presets
world.js          terrain, fields layout, props, trees, lantern, sky/clouds, day/night, physics stepping
veg.js            GPU wheat/grass fields that follow the player
player.js         first-person walk/flight + ring-hand view model
constructs.js     hard-light material, sketch → slab/rod, construct physics + strain
library.js        detailed constructs for recognised doodles
doodle.js         Quick, Draw! CNN inference + stroke rasteriser
settings.js       persisted settings
tools/            data/texture fetchers, model training, voice generation
public/doodle/    trained model weights
```
