# Fetch CC0 PBR textures from Poly Haven (diffuse, GL normal, packed AO/rough/metal) → public/tex/<id>/
import json, urllib.request, os
SETS = {'farm_soil': '2k', 'grass_path_2': '2k', 'distressed_painted_planks': '1k', 'corrugated_iron': '1k', 'green_metal_rust': '1k'}
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'arm': 'arm'}
UA = {'User-Agent': 'lantern-game-dev/1.0 (personal project)'}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA))
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'tex')
for aid, res in SETS.items():
    files = json.load(get(f'https://api.polyhaven.com/files/{aid}'))
    os.makedirs(os.path.join(root, aid), exist_ok=True)
    for k, short in MAPS.items():
        out = os.path.join(root, aid, f'{short}.jpg')
        if os.path.exists(out): continue
        url = files[k][res]['jpg']['url']
        assert url.startswith('https://dl.polyhaven.org/'), url
        open(out, 'wb').write(get(url).read())
    print(aid, res, flush=True)
