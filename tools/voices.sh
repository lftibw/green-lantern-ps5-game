#!/bin/sh
# Render placeholder voice lines with macOS `say` → public/vo/<id>.wav (swap for real VO later; ids stay the same).
cd "$(dirname "$0")/.." && mkdir -p public/vo
while IFS='|' read -r id voice rate text; do
  [ -z "$id" ] && continue
  say -v "$voice" -r "$rate" --file-format=WAVE --data-format=LEI16@24000 -o "public/vo/$id.wav" "$text"
done < tools/vo.txt
ls public/vo | wc -l
