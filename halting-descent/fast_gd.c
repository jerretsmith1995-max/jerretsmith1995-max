/* Dense gradient descent on  L(z) = 1/2 * || z - f(z) ||^2  where f is the frozen ReLU
 * network compiled from a Turing machine (see compiler.py for the same network in PyTorch).
 *
 * Every coordinate of z is updated on every step; nothing is skipped or event-driven.
 * The gradient used is  z - f(z).  The other chain-rule term, -J_f(z)^T (z - f(z)), is
 * exactly zero whenever no coordinate sits in the transition band of the quantiser q,
 * and this program measures the distance to that band on every step ("margin") and
 * aborts if it is ever violated.  verify.py checks the same thing against autograd.
 *
 * usage: fast_gd SPEC N ORIGIN MAX_STEPS ETA OUT_PREFIX [dump_step ...]
 *        fast_gd SPEC ref          (reference simulation only: steps, ones, tape extent)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define QLO 0.4
#define QHI 0.6
#define MAXS 8
#define ROWS 640
#define COLS 800

static inline double relu(double x) { return x > 0 ? x : 0; }
static inline double q(double x) { double y = (x - QLO) / (QHI - QLO); return y < 0 ? 0 : (y > 1 ? 1 : y); }

static int S, wr[MAXS][2], mv[MAXS][2], nx[MAXS][2];

static void parse(const char *spec) {
    S = 0;
    for (const char *p = spec; *p; ) {
        for (int b = 0; b < 2; b++, p += 3) {
            wr[S][b] = p[0] - '0'; mv[S][b] = p[1] == 'R' ? 1 : -1;
            nx[S][b] = p[2] == 'Z' ? -1 : p[2] - 'A';
        }
        S++; if (*p == '_') p++;
    }
}

static void dump(const char *prefix, long step, double *s, double *h, double *c, long N) {
    char name[512]; snprintf(name, sizeof name, "%s_state_%ld.bin", prefix, step);
    FILE *f = fopen(name, "wb");
    fwrite(s, 8, N, f); fwrite(h, 8, N, f); fwrite(c, 8, S + 1, f); fclose(f);
}

int main(int argc, char **argv) {
    parse(argv[1]);
    if (argc == 3) {                       /* plain reference simulation */
        long N = 1 << 22, pos = N / 2, lo = pos, hi = pos, steps = 0, ones = 0; int st = 0;
        char *t = calloc(N, 1);
        while (st >= 0) { int b = t[pos]; t[pos] = wr[st][b]; pos += mv[st][b]; st = nx[st][b];
            steps++; if (pos < lo) lo = pos; if (pos > hi) hi = pos; }
        for (long i = 0; i < N; i++) ones += t[i];
        printf("steps=%ld ones=%ld lo=%ld hi=%ld\n", steps, ones, lo - N / 2, hi - N / 2);
        return 0;
    }
    long N = atol(argv[2]), origin = atol(argv[3]), max_steps = atol(argv[4]);
    double eta = atof(argv[5]); const char *prefix = argv[6];
    int ndump = argc - 7; long dumps[64]; for (int i = 0; i < ndump; i++) dumps[i] = atol(argv[7 + i]);

    /* z = (s, h, c): tape symbols, head position one-hot, control state one-hot (+ halt unit).
       arrays are padded by one cell on each side so the shifted reads need no branches. */
    double *s = calloc(N + 2, 8) , *h = calloc(N + 2, 8), *qs = calloc(N + 2, 8), *qh = calloc(N + 2, 8);
    double c[MAXS + 1] = {0}, qc[MAXS + 1], fc[MAXS + 1];
    s++; h++; qs++; qh++;
    h[origin] = 1; c[0] = 1;

    long bucket = max_steps / ROWS + 1;
    float *img = calloc((size_t)ROWS * COLS, 4); float *headcol = calloc(ROWS, 4);
    double *lmean = calloc(ROWS, 8), *lmin = calloc(ROWS, 8), *lmax = calloc(ROWS, 8);
    for (int i = 0; i < ROWS; i++) lmin[i] = 1e300;
    double margin_min = 1e300; long step = 0, converged_at = -1; int nd = 0;

    for (; step < max_steps; step++) {
        if (nd < ndump && dumps[nd] == step) { dump(prefix, step, s, h, c, N); nd++; }
        /* quantiser layer + distance of every coordinate from the transition band */
        double margin = 1e300, r = 0;
        for (long i = 0; i < N; i++) {
            qs[i] = q(s[i]); qh[i] = q(h[i]);
            double a = fabs(s[i] - 0.5), b = fabs(h[i] - 0.5);
            double m = a < b ? a : b; margin = m < margin ? m : margin;
            r += relu(qh[i] + qs[i] - 1);               /* bit under the head */
        }
        for (int k = 0; k <= S; k++) { qc[k] = q(c[k]); double a = fabs(c[k] - 0.5); margin = a < margin ? a : margin; }
        if (margin < margin_min) margin_min = margin;
        if (margin < 0.1) { printf("MARGIN VIOLATED at step %ld (%.4f)\n", step, margin); return 1; }

        /* control layer */
        double W1 = 0, mR = 0, mL = 0, mS = qc[S];
        for (int k = 0; k <= S; k++) fc[k] = 0;
        fc[S] = qc[S];
        for (int k = 0; k < S; k++) for (int b = 0; b < 2; b++) {
            double g = b ? relu(qc[k] + r - 1) : relu(qc[k] - r);
            if (wr[k][b]) W1 += g;
            if (mv[k][b] > 0) mR += g; else mL += g;
            fc[nx[k][b] < 0 ? S : nx[k][b]] += g;
        }
        /* tape layer, residual, and the descent step, for every cell */
        double loss = 0;
        for (long i = 0; i < N; i++) {
            double fs = relu(qs[i] - qh[i]) + relu(qh[i] + W1 - 1) + relu(qh[i] + qs[i] + mS - 2);
            double fh = relu(qh[i - 1] + mR - 1) + relu(qh[i + 1] + mL - 1) + relu(qh[i] + mS - 1);
            double gs = s[i] - fs, gh = h[i] - fh;
            loss += gs * gs + gh * gh;
            s[i] -= eta * gs; h[i] -= eta * gh;
        }
        for (int k = 0; k <= S; k++) { double g = c[k] - fc[k]; loss += g * g; c[k] -= eta * g; }
        loss *= 0.5;

        long row = step / bucket;
        lmean[row] += loss; if (loss < lmin[row]) lmin[row] = loss; if (loss > lmax[row]) lmax[row] = loss;
        if (step % bucket == 0) {
            for (long i = 0; i < N; i++) { img[row * COLS + i * COLS / N] += (float)qs[i] * COLS / N;
                if (qh[i] > 0.5) headcol[row] = (float)i / N; }
        }
        if (loss < 1e-24) { converged_at = step; break; }
    }
    for (int i = nd; i < ndump; i++) if (dumps[i] >= step) { dump(prefix, step, s, h, c, N); break; }

    long ones = 0; for (long i = 0; i < N; i++) ones += q(s[i]) > 0.5;
    long rows_used = step / bucket + 1;
    for (long i = 0; i < rows_used; i++) { long n = (i + 1) * bucket <= step ? bucket : step % bucket + 1; lmean[i] /= n; }
    char name[512];
    snprintf(name, sizeof name, "%s_img.bin", prefix); FILE *f = fopen(name, "wb"); fwrite(img, 4, (size_t)ROWS * COLS, f); fclose(f);
    snprintf(name, sizeof name, "%s_summary.json", prefix); f = fopen(name, "w");
    fprintf(f, "{\"N\":%ld,\"origin\":%ld,\"eta\":%g,\"first_zero_loss_step\":%ld,\"ones\":%ld,\"halted\":%s,"
               "\"margin_min\":%.6f,\"bucket\":%ld,\"rows\":%ld,\"cols\":%d,\n\"loss_mean\":[",
            N, origin, eta, converged_at, ones, q(c[S]) > 0.5 ? "true" : "false", margin_min, bucket, rows_used, COLS);
    for (long i = 0; i < rows_used; i++) fprintf(f, "%s%.6g", i ? "," : "", lmean[i]);
    fprintf(f, "],\n\"loss_min\":["); for (long i = 0; i < rows_used; i++) fprintf(f, "%s%.6g", i ? "," : "", lmin[i]);
    fprintf(f, "],\n\"loss_max\":["); for (long i = 0; i < rows_used; i++) fprintf(f, "%s%.6g", i ? "," : "", lmax[i]);
    fprintf(f, "],\n\"head\":["); for (long i = 0; i < rows_used; i++) fprintf(f, "%s%.4f", i ? "," : "", headcol[i]);
    fprintf(f, "]}\n"); fclose(f);
    printf("first_zero_loss_step=%ld ones=%ld margin_min=%.4f\n", converged_at, ones, margin_min);
    return 0;
}
