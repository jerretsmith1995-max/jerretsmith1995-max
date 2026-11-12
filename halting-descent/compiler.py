"""Compile a Turing machine into a training run.

compile_machine(spec, N) returns a frozen ReLU network f and an initial parameter vector z0
such that ordinary gradient descent with learning rate 1 on

        L(z) = 1/2 * || z - f(z) ||^2

executes one Turing machine step per gradient step, and L reaches exactly 0 on the step
the machine halts (a halted configuration is a fixed point of f, so it is a global minimum).

The trainable parameter z is the concatenation of
    s  (N)    tape symbols
    h  (N)    head position, one-hot
    c  (S+1)  control state, one-hot, last unit = "halted"

f is built only from affine maps and ReLU, in four stages:
    q        hard-sigmoid quantiser  q(x) = relu(5x-2) - relu(5x-3)   (flat outside (0.4, 0.6))
    read     r = sum_i relu(h_i + s_i - 1)                             (bit under the head)
    control  g[k,b] = relu(c_k + r - 1) or relu(c_k - r)               (which transition fires)
    tape     s'_i = relu(s_i - h_i) + relu(h_i + W1 - 1) + relu(h_i + s_i + halt - 2)
             h'_i = relu(h_{i-1} + R - 1) + relu(h_{i+1} + L - 1) + relu(h_i + halt - 1)
with W1, R, L and the next control state all linear in g.  Width is O(N), weights are
translation-invariant along the tape (it is a 1-D convolution plus a small global unit).

Why gradient descent runs it:  grad L = (I - J_f)^T (z - f(z)).  At any z whose coordinates
all sit outside the quantiser's transition band, f is locally constant, J_f = 0, and the
gradient is exactly z - f(z); a step of size 1 lands on f(z), which is again a bit vector.
"""
import torch
import torch.nn.functional as F
from machines import parse

relu = torch.relu


class CompiledMachine(torch.nn.Module):
    def __init__(self, spec, N):
        super().__init__()
        table = parse(spec)
        S = len(table)
        self.S, self.N = S, N
        # linear read-outs of the 2S transition units g[k,b]
        write1, right, left = torch.zeros(2 * S), torch.zeros(2 * S), torch.zeros(2 * S)
        nxt = torch.zeros(S + 1, 2 * S)
        for k in range(S):
            for b in (0, 1):
                w, m, n = table[k][b]
                j = 2 * k + b
                write1[j] = w
                (right if m > 0 else left)[j] = 1
                nxt[S if n < 0 else n, j] = 1
        for name, t in dict(write1=write1, right=right, left=left, nxt=nxt).items():
            self.register_buffer(name, t.double())

    def split(self, z):
        N = self.N
        return z[..., :N], z[..., N:2 * N], z[..., 2 * N:]

    def forward(self, z):
        s, h, c = self.split(z)
        q = lambda x: relu(5 * x - 2) - relu(5 * x - 3)
        s, h, c = q(s), q(h), q(c)
        halt = c[..., -1:]
        r = relu(h + s - 1).sum(-1, keepdim=True)
        g = torch.stack([relu(c[..., :-1] - r), relu(c[..., :-1] + r - 1)], -1).flatten(-2)
        W1, R, L = g @ self.write1, g @ self.right, g @ self.left
        W1, R, L = W1[..., None], R[..., None], L[..., None]
        c_new = g @ self.nxt.T
        c_new = torch.cat([c_new[..., :-1], c_new[..., -1:] + halt], -1)
        s_new = relu(s - h) + relu(h + W1 - 1) + relu(h + s + halt - 2)
        h_from_left = F.pad(h, (1, 0))[..., :-1]      # h_{i-1}
        h_from_right = F.pad(h, (0, 1))[..., 1:]      # h_{i+1}
        h_new = relu(h_from_left + R - 1) + relu(h_from_right + L - 1) + relu(h + halt - 1)
        return torch.cat([s_new, h_new, c_new], -1)

    def loss(self, z):
        return 0.5 * (z - self(z)).pow(2).sum()

    def init(self, origin):
        z = torch.zeros(2 * self.N + self.S + 1, dtype=torch.double)
        z[self.N + origin] = 1      # head
        z[2 * self.N] = 1           # state A
        return z

    def decode(self, z):
        """-> (tape bits, head index, state index or -1 if halted)"""
        s, h, c = self.split(z)
        k = int(c.argmax())
        return (s > 0.5).int().tolist(), int(h.argmax()), -1 if k == self.S else k


def compile_machine(spec, N, origin=None):
    net = CompiledMachine(spec, N)
    return net, net.init(N // 2 if origin is None else origin)


def train(net, z0, steps, lr=1.0):
    """Plain torch.optim.SGD. Yields (step, loss, z) before each update."""
    z = torch.nn.Parameter(z0.clone())
    opt = torch.optim.SGD([z], lr=lr)
    for t in range(steps):
        opt.zero_grad()
        loss = net.loss(z)
        loss.backward()
        yield t, loss.item(), z
        opt.step()
