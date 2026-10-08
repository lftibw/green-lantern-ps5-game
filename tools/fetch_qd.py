# Fetch the first N drawings per class from Google's Quick, Draw! numpy bitmaps via HTTP Range (CC BY 4.0).
import urllib.request, urllib.parse, os, ast, sys
N = 12000
root = os.path.dirname(os.path.abspath(__file__))
for name in open(os.path.join(root, 'classes.txt')).read().split('\n'):
    if not name: continue
    out = os.path.join(root, 'qd', name.replace(' ', '_') + '.bin')
    if os.path.exists(out): continue
    url = 'https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/' + urllib.parse.quote(name) + '.npy'
    head = urllib.request.urlopen(urllib.request.Request(url, headers={'Range': 'bytes=0-255'})).read()
    hlen = int.from_bytes(head[8:10], 'little'); start = 10 + hlen
    meta = ast.literal_eval(head[10:start].decode('latin1'))
    assert meta['descr'] == '|u1' and meta['shape'][1] == 784, meta
    n = min(N, meta['shape'][0])
    data = urllib.request.urlopen(urllib.request.Request(url, headers={'Range': f'bytes={start}-{start + n * 784 - 1}'})).read()
    assert len(data) == n * 784
    open(out, 'wb').write(data)
    print(name, n, flush=True)
