"""Turing machines in the standard Busy Beaver text format, plus a plain reference simulator.

Format: one block per state, separated by '_'; each block is two triples
(for reading 0, then reading 1): <write><move><next state>.  'Z' is the halt state.
"""

MACHINES = {
    # name: (spec, proven number of steps to halt, or None if it never halts)
    "BB(2)": ("1RB1LB_1LA1RZ", 6),
    "BB(3)": ("1RB1RZ_1LB0RC_1LC1LA", 21),
    "BB(4)": ("1RB1LB_1LA0LC_1RZ1LD_1RD0RA", 107),
    "BB(5)": ("1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA", 47_176_870),
    # sweeps back and forth over an ever-growing block of ones: the training run that never converges
    "sweeper (never halts)": ("1RB1LA_1LA1RB", None),
}


def parse(spec):
    """-> list over states of [(write, move, next), (write, move, next)]; next == -1 means halt."""
    table = []
    for block in spec.split("_"):
        row = []
        for k in (0, 3):
            w, m, n = block[k], block[k + 1], block[k + 2]
            row.append((int(w), +1 if m == "R" else -1, -1 if n == "Z" else ord(n) - 65))
        table.append(row)
    return table


def simulate(spec, max_steps=10**9):
    """Reference simulation on an unbounded tape. Returns (steps, ones, min_pos, max_pos, halted)."""
    table = parse(spec)
    tape, pos, state, steps, lo, hi = {}, 0, 0, 0, 0, 0
    while state != -1 and steps < max_steps:
        w, m, n = table[state][tape.get(pos, 0)]
        tape[pos] = w
        pos += m
        state = n
        steps += 1
        lo, hi = min(lo, pos), max(hi, pos)
    return steps, sum(tape.values()), lo, hi, state == -1


def reference_trace(spec, N, origin, steps):
    """Configurations (tape, head, state) on a fixed N-cell tape for steps 0..steps."""
    table = parse(spec); tape = [0] * N; pos, st = origin, 0
    out = [(list(tape), pos, st)]
    for _ in range(steps):
        if st != -1:
            w, m, n = table[st][tape[pos]]
            tape[pos] = w; pos += m; st = n
        out.append((list(tape), pos, st))
    return out


if __name__ == "__main__":
    for name, (spec, expected) in MACHINES.items():
        if name == "BB(5)":
            continue
        print(name, simulate(spec, 2000), "expected", expected)
