# Halting Descent

A compiler from Turing machines to training runs.

`compile_machine(spec, N)` returns a frozen ReLU network `f` and a starting vector `z0`.
Plain gradient descent with learning rate 1 on

    L(z) = 1/2 * || z - f(z) ||^2

executes the machine, one machine step per gradient step. The loss is exactly 0 on the
step the machine halts, and never 0 before it.

```python
from compiler import compile_machine
import torch

net, z0 = compile_machine("1RB1LB_1LA0LC_1RZ1LD_1RD0RA", N=32)   # 4-state Busy Beaver
z = torch.nn.Parameter(z0)
opt = torch.optim.SGD([z], lr=1.0)
step = 0
while True:
    loss = net.loss(z)
    if loss == 0: break
    opt.zero_grad(); loss.backward(); opt.step(); step += 1
print(step)   # 107
```

## Results

| Program | Proven halting time | Step where loss first equals 0 | How it was run |
|---|---|---|---|
| BB(2) | 6 | 6 | `torch.optim.SGD`, autograd |
| BB(3) | 21 | 21 | `torch.optim.SGD`, autograd |
| BB(4) | 107 | 107 | `torch.optim.SGD`, autograd |
| BB(5) | 47,176,870 | 47,176,870 | dense C update over 24,806 weights, cross-checked against autograd |
| sweeper | never halts | never (20,000 steps run) | `torch.optim.SGD`, autograd |

- BB(5) ends with 4,098 ones on the tape, the proven value.
- The C run was compared with autograd over steps 1,000,000 to 1,002,000 and from step
  47,175,000 to the halt. The weight vectors are identical.
- The same BB(5) run also completes correctly at learning rates 0.8 and 1.2.
- For BB(4), with no noise, every learning rate from 0.62 to 1.46 runs the program
  correctly (guaranteed interval: 0.714 to 1.286). With Gaussian gradient noise of
  standard deviation 0.04, all 64 trials succeed for learning rates 0.72 to 1.34.

## Why it works

`z` holds the tape, a one-hot head position and a one-hot control state. The first layer of
`f` is a hard threshold that is flat outside (0.4, 0.6). When every weight is outside that
band, `f` is locally constant, so the gradient of `L` is exactly `z - f(z)` and one step of
size 1 lands on `f(z)`, the next configuration. A halted configuration is a fixed point of
`f`, so it is a global minimum.

A weight that is off its bit by `d` is off by `|1-lr| * d` after a step, or by at most
`|1-lr| * (1 + d)` if its target flipped. That stays out of the band whenever
`|1-lr| <= 0.4/1.4`, which gives the guaranteed interval above.

## Limits

- The network is built for the purpose. The trained weights are the program's memory and
  the network that reads them is frozen. This is not a claim about training on data.
- The tape is finite (N cells), so any single compiled run is a finite-state system. The
  undecidable question is over the family: given a machine, is there an N for which the
  compiled run reaches zero loss.
- The idea that gradient descent can simulate a Turing machine is prior work:
  Welper, "Universality of Gradient Descent Neural Network Training" (arXiv:2007.13664);
  Chatziafratis, Roughgarden, Wang, "On the Computational Power of Online Gradient
  Descent" (arXiv:1807.01280). What this repository adds is a runnable compiler, the BB(5)
  run, and the measured tolerance to learning rate and noise.

## Files

| File | Purpose |
|---|---|
| `machines.py` | machine definitions and a plain reference simulator |
| `compiler.py` | the compiler and the network, in PyTorch |
| `fast_gd.c` | dense C implementation of the same update, for the 47M-step runs |
| `verify.py` | autograd cross-checks |
| `robustness.py` | learning rate and noise sweep |
| `build_page.py`, `page.template.html` | builds `page.html`, the interactive write-up |
| `run_all.sh` | reproduces everything (about 25 minutes on 4 cores; needs gcc, PyTorch, numpy) |
| `out/*.json` | recorded results |
