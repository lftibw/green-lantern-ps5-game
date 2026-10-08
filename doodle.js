// Doodle recognition: tiny CNN trained on Google's Quick, Draw! (tools/train_doodle.py), run in plain JS (~1 ms).
// Strokes are rendered the way the dataset was: white ink, max side ≈ 24 px, centred in 28×28.
const meta = await (await fetch('/doodle/meta.json')).json();
const W = new Float32Array(await (await fetch('/doodle/weights.bin')).arrayBuffer());
const P = {}; { let o = 0; for (const k of meta.order) { const n = meta.shapes[k].reduce((a, b) => a * b, 1); P[k] = W.subarray(o, o + n); o += n; } }
export const CLASSES = meta.classes;

function conv(x, C, H, w, b, O) { // 3×3, pad 1, then ReLU + 2×2 max-pool (floor)
  const y = new Float32Array(O * H * H);
  for (let o = 0; o < O; o++) for (let i = 0; i < H; i++) for (let j = 0; j < H; j++) {
    let s = b[o];
    for (let c = 0; c < C; c++) {
      const wo = (o * C + c) * 9, xo = c * H * H;
      for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= H) continue;
        for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; s += w[wo + (di + 1) * 3 + dj + 1] * x[xo + ii * H + jj]; } }
    }
    y[o * H * H + i * H + j] = s > 0 ? s : 0;
  }
  const h = H >> 1, p = new Float32Array(O * h * h);
  for (let o = 0; o < O; o++) for (let i = 0; i < h; i++) for (let j = 0; j < h; j++) {
    const a = o * H * H + 2 * i * H + 2 * j;
    p[o * h * h + i * h + j] = Math.max(y[a], y[a + 1], y[a + H], y[a + H + 1]);
  }
  return p;
}
function dense(x, w, b, relu) {
  const n = b.length, m = x.length, y = new Float32Array(n);
  for (let o = 0; o < n; o++) { let s = b[o]; for (let k = 0; k < m; k++) s += w[o * m + k] * x[k]; y[o] = relu && s < 0 ? 0 : s; }
  return y;
}
// img: Float32Array(784) in 0..1 → probabilities per class
export function predict(img) {
  let x = conv(img, 1, 28, P['c1.weight'], P['c1.bias'], 16);
  x = conv(x, 16, 14, P['c2.weight'], P['c2.bias'], 32);
  x = conv(x, 32, 7, P['c3.weight'], P['c3.bias'], 64);
  x = dense(dense(x, P['f1.weight'], P['f1.bias'], true), P['f2.weight'], P['f2.bias'], false);
  const mx = Math.max(...x); let s = 0; const e = x.map((v) => { const q = Math.exp(v - mx); s += q; return q; });
  return e.map((v) => v / s);
}

const big = document.createElement('canvas'); big.width = big.height = 256;
const small = document.createElement('canvas'); small.width = small.height = 28;
const bx = big.getContext('2d'), sx = small.getContext('2d', { willReadFrequently: true });
// strokes: array of [{x,y}] in touchpad units (x already aspect-corrected, y up)
export function rasterize(strokes) {
  const all = strokes.flat();
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = 220 / Math.max(x1 - x0, y1 - y0, 1e-3), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  bx.fillStyle = '#000'; bx.fillRect(0, 0, 256, 256);
  bx.strokeStyle = '#fff'; bx.lineWidth = 16; bx.lineCap = bx.lineJoin = 'round';
  for (const s of strokes) {
    bx.beginPath();
    s.forEach((p, i) => { const X = 128 + (p.x - cx) * k, Y = 128 - (p.y - cy) * k; i ? bx.lineTo(X, Y) : bx.moveTo(X, Y); });
    if (s.length === 1) bx.lineTo(128 + (s[0].x - cx) * k + 0.1, 128 - (s[0].y - cy) * k);
    bx.stroke();
  }
  sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
  sx.drawImage(big, 0, 0, 28, 28);
  const d = sx.getImageData(0, 0, 28, 28).data, img = new Float32Array(784);
  for (let i = 0; i < 784; i++) img[i] = d[i * 4] / 255;
  return img;
}
// → [{name, p}] top-k
export function classify(strokes, k = 3) {
  const p = predict(rasterize(strokes));
  return [...p].map((v, i) => ({ name: CLASSES[i], p: v })).sort((a, b) => b.p - a.p).slice(0, k);
}
