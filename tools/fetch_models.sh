#!/bin/sh
# Mixamo "X Bot" rig as shipped in the three.js examples (used as the Lantern body; restyled by suit/suit.js).
cd "$(dirname "$0")/.." && mkdir -p public/models
curl -fsSL -A "lantern-game-dev/1.0" -o public/models/Xbot.glb https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/Xbot.glb
ls -la public/models
