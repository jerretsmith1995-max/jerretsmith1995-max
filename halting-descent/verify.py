"""Checks that the compiled training runs do what is claimed, using PyTorch autograd.

1. BB(2), BB(3), BB(4): torch.optim.SGD(lr=1) reproduces the reference Turing machine
   configuration at every step, autograd's gradient equals z - f(z) exactly, and the loss is
   first exactly zero on the proven halting step.
2. A machine that never halts: the loss never reaches zero.
3. BB(5): the dense C run (fast_gd.c) is cross-checked against autograd on two windows,
   including the last 1,870 steps up to the halt at step 47,176,870.
"""
import json, os, sys
import numpy as np, torch
from machines import MACHINES, reference_trace
from compiler import compile_machine, train

results = {}


for name in ["BB(2)", "BB(3)", "BB(4)"]:
    spec, T = MACHINES[name]
    N = 32
    net, z0 = compile_machine(spec, N)
    ref = reference_trace(spec, N, N // 2, T + 20)
    first_zero, max_grad_err, losses = None, 0.0, []
    for t, loss, z in train(net, z0, T + 20):
        assert net.decode(z.data) == ref[t], f"{name}: mismatch at step {t}"
        max_grad_err = max(max_grad_err, (z.grad - (z.data - net(z.data))).abs().max().item())
        losses.append(loss)
        if loss == 0 and first_zero is None:
            first_zero = t
    assert first_zero == T and max_grad_err == 0
    results[name] = dict(halting_steps=T, first_zero_loss_step=first_zero, autograd_grad_error=max_grad_err,
                         losses=losses[:T + 3])
    print(f"{name}: loss first hits 0 at step {first_zero} (proven halting time {T}); "
          f"every configuration matches; autograd error {max_grad_err}")

name = "sweeper (never halts)"
spec, _ = MACHINES[name]
net, z0 = compile_machine(spec, 4096)
min_loss = min(loss for _, loss, _ in train(net, z0, 20000))
assert min_loss > 0
results[name] = dict(steps_run=20000, min_loss=min_loss)
print(f"{name}: 20000 steps, loss never below {min_loss}")

if os.path.exists("out/bb5_summary.json"):
    spec, T = MACHINES["BB(5)"]
    summ = json.load(open("out/bb5_summary.json"))
    N, origin = summ["N"], summ["origin"]
    net, _ = compile_machine(spec, N, origin)
    load = lambda step: torch.from_numpy(np.fromfile(f"out/bb5_state_{step}.bin"))
    # window 1: steps 1,000,000 -> 1,002,000
    zs = [z.data.clone() for _, _, z in train(net, load(1000000), 2001)]
    assert torch.equal(zs[-1], load(1002000))
    # window 2: step 47,175,000 -> halt
    first_zero = None
    for t, loss, z in train(net, load(47175000), 2000):
        assert (z.grad - (z.data - net(z.data))).abs().max().item() == 0
        if loss == 0:
            first_zero = 47175000 + t; final = z.data.clone(); break
    assert first_zero == T == summ["first_zero_loss_step"], first_zero
    assert torch.equal(final, load(T))
    ones = int((final[:N] > 0.5).sum())
    assert ones == 4098
    results["BB(5)"] = dict(halting_steps=T, first_zero_loss_step=first_zero, ones_on_tape=ones,
                            tape_cells=N, parameters=2 * N + 6, c_run_margin_min=summ["margin_min"],
                            autograd_windows=[[1000000, 1002000], [47175000, T]])
    print(f"BB(5): C run reaches zero loss at step {summ['first_zero_loss_step']:,}; autograd agrees on both "
          f"windows and halts at step {first_zero:,} with {ones} ones on the tape")
else:
    print("BB(5): out/bb5_summary.json not found, run run_bb5.sh first", file=sys.stderr)

json.dump(results, open("out/verify.json", "w"))
