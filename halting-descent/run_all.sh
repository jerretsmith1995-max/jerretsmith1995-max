#!/bin/sh
# Reproduces every number on the page. About 25 minutes on 4 cores.
set -e
cd "$(dirname "$0")"
mkdir -p out
gcc -O3 -march=native -fno-math-errno -ffinite-math-only -fassociative-math -fno-signed-zeros \
    -fno-trapping-math -o fast_gd fast_gd.c -lm
BB5=1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA
./fast_gd $BB5 ref                         # plain simulation: 47,176,870 steps, tape extent
# dense gradient descent, 12,400 tape cells, head starts at cell 12,300
./fast_gd $BB5 12400 12300 47300000 1.0 out/bb5 1000000 1002000 47175000 47177000 &
./fast_gd $BB5 12400 12300 47300000 0.8 out/bb5_eta08 &
./fast_gd $BB5 12400 12300 47300000 1.2 out/bb5_eta12 &
wait
python3 verify.py        # autograd cross-checks
python3 robustness.py    # learning rate x noise sweep
python3 build_page.py    # page.html
