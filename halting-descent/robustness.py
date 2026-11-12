"""How wrong can the optimiser be before the computation breaks?

Runs the BB(4) training run under every combination of learning rate and Gaussian gradient
noise, using the full autograd gradient (no assumption that the Jacobian term vanishes).
A trial succeeds if the decoded configuration matches the reference Turing machine at every
one of the 107 steps and then stays halted for 20 more.

Prediction (noise-free): a coordinate that is off its bit by d is off by |1-lr| * d after a
step, and by at most |1-lr| * (1+d) if its target flipped.  The worst case stays out of the
quantiser's transition band (|d| <= 0.4) iff |1-lr| <= 0.4/1.4, i.e. lr in [0.714, 1.286].
"""
import json, torch
from machines import MACHINES, reference_trace
from compiler import compile_machine

torch.manual_seed(0)
spec, T = MACHINES["BB(4)"]
N, extra, trials = 32, 20, 64
net, z0 = compile_machine(spec, N)
ref = reference_trace(spec, N, N // 2, T + extra)
ref_s = torch.tensor([r[0] for r in ref]); ref_h = torch.tensor([r[1] for r in ref])
ref_c = torch.tensor([net.S if r[2] < 0 else r[2] for r in ref])

lrs = torch.linspace(0.5, 1.5, 51, dtype=torch.double)
sigmas = torch.linspace(0, 0.1, 21, dtype=torch.double)
LR, SG = torch.meshgrid(lrs, sigmas, indexing="ij")
lr = LR.reshape(-1, 1).repeat_interleave(trials, 0)
sg = SG.reshape(-1, 1).repeat_interleave(trials, 0)
z = z0.repeat(lr.shape[0], 1).requires_grad_()
ok = torch.ones(lr.shape[0], dtype=torch.bool)
for t in range(T + extra + 1):
    s, h, c = net.split(z.data)
    ok &= ((s > 0.5).int() == ref_s[t]).all(-1) & (h.argmax(-1) == ref_h[t]) & (c.argmax(-1) == ref_c[t])
    (grad,) = torch.autograd.grad(net.loss(z), z)
    z.data -= lr * (grad + sg * torch.randn_like(grad))
rate = ok.double().reshape(len(lrs), len(sigmas), trials).mean(-1)
json.dump(dict(lrs=lrs.tolist(), sigmas=sigmas.tolist(), success=rate.tolist(), trials=trials,
               predicted_lr_interval=[1 - 0.4 / 1.4, 1 + 0.4 / 1.4]), open("out/robustness.json", "w"))
good = lrs[rate[:, 0] == 1]
print(f"noise-free: correct for lr in [{good.min():.2f}, {good.max():.2f}]  (predicted [0.714, 1.286])")
for j in (4, 8, 12, 16, 20):
    good = lrs[rate[:, j] == 1]
    print(f"sigma={sigmas[j]:.2f}: all {trials} trials correct for lr in "
          + (f"[{good.min():.2f}, {good.max():.2f}]" if len(good) else "(none)"))
