# Train a tiny doodle CNN on Quick, Draw! bitmaps (MPS), export float32 weights for the browser (doodle.js).
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F, json, os, time
root = os.path.dirname(os.path.abspath(__file__))
names = [n for n in open(os.path.join(root, 'classes.txt')).read().split('\n') if n]
X = np.concatenate([np.fromfile(os.path.join(root, 'qd', n.replace(' ', '_') + '.bin'), np.uint8).reshape(-1, 1, 28, 28) for n in names])
Y = np.concatenate([np.full(len(X) // len(names), k) for k in range(len(names))])
rng = np.random.default_rng(0); idx = rng.permutation(len(X)); X, Y = X[idx], Y[idx]
nv = 12000; Xv, Yv, Xt, Yt = X[:nv], Y[:nv], X[nv:], Y[nv:]
dev = 'mps'

class Net(nn.Module):
    def __init__(s, k):
        super().__init__()
        s.c1 = nn.Conv2d(1, 16, 3, padding=1); s.c2 = nn.Conv2d(16, 32, 3, padding=1); s.c3 = nn.Conv2d(32, 64, 3, padding=1)
        s.f1 = nn.Linear(64 * 3 * 3, 128); s.f2 = nn.Linear(128, k); s.d = nn.Dropout(0.3)
    def forward(s, x):
        x = F.max_pool2d(F.relu(s.c1(x)), 2); x = F.max_pool2d(F.relu(s.c2(x)), 2); x = F.max_pool2d(F.relu(s.c3(x)), 2)
        return s.f2(s.d(F.relu(s.f1(x.flatten(1)))))

def augment(x):  # small rotate/scale/shift + random stroke thickening (touchpad strokes vary)
    b = x.shape[0]; a = (torch.rand(b, device=dev) - 0.5) * 0.5; sc = 0.85 + torch.rand(b, device=dev) * 0.3
    t = (torch.rand(b, 2, device=dev) - 0.5) * 0.2
    th = torch.stack([torch.stack([sc * torch.cos(a), -sc * torch.sin(a), t[:, 0]], 1), torch.stack([sc * torch.sin(a), sc * torch.cos(a), t[:, 1]], 1)], 1)
    x = F.grid_sample(x, F.affine_grid(th, x.shape, align_corners=False), align_corners=False)
    thick = torch.rand(b, 1, 1, 1, device=dev) < 0.3
    return torch.where(thick, F.max_pool2d(x, 3, 1, 1), x)

net = Net(len(names)).to(dev)
opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
Xt_t = torch.tensor(Xt); Yt_t = torch.tensor(Yt); Xv_t = torch.tensor(Xv, device=dev).float() / 255; Yv_t = torch.tensor(Yv, device=dev)
E = 8; sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=E * (len(Xt) // 256 + 1))
for ep in range(E):
    net.train(); t0 = time.time(); perm = torch.randperm(len(Xt))
    for i in range(0, len(Xt), 256):
        j = perm[i:i + 256]; x = augment(Xt_t[j].to(dev).float() / 255); y = Yt_t[j].to(dev)
        loss = F.cross_entropy(net(x), y, label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    net.eval()
    with torch.no_grad(): acc = (torch.cat([net(Xv_t[i:i + 2000]).argmax(1) for i in range(0, nv, 2000)]) == Yv_t).float().mean().item()
    print(f'epoch {ep} loss {loss.item():.3f} val {acc:.3f} {time.time() - t0:.0f}s', flush=True)

# per-class accuracy so the game knows which labels to trust
with torch.no_grad(): pred = torch.cat([net(Xv_t[i:i + 2000]).argmax(1) for i in range(0, nv, 2000)]).cpu().numpy()
per = {n: float((pred[Yv == k] == k).mean()) for k, n in enumerate(names)}
print(json.dumps(per, indent=0))
out = os.path.join(root, '..', 'public', 'doodle')
os.makedirs(out, exist_ok=True)
sd = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in net.state_dict().items()}
order = ['c1.weight', 'c1.bias', 'c2.weight', 'c2.bias', 'c3.weight', 'c3.bias', 'f1.weight', 'f1.bias', 'f2.weight', 'f2.bias']
np.concatenate([sd[k].ravel() for k in order]).tofile(os.path.join(out, 'weights.bin'))
json.dump({'classes': names, 'shapes': {k: list(sd[k].shape) for k in order}, 'order': order, 'valAcc': per}, open(os.path.join(out, 'meta.json'), 'w'))
# reference outputs for the JS parity check
np.save(os.path.join(root, 'qd', 'ref_x.npy'), Xv[:8]); 
with torch.no_grad(): json.dump(F.softmax(net(Xv_t[:8]), 1).cpu().numpy().tolist(), open(os.path.join(out, 'ref.json'), 'w'))
json.dump(Xv[:8].reshape(8, -1).tolist(), open(os.path.join(out, 'ref_x.json'), 'w'))
