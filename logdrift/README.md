# logdrift

**Diff the behavior of logs, not their bytes.**

You have a run that worked and a run that didn't. `diff good.log bad.log` is useless: every line
differs by a timestamp, a request ID, a PID or a latency. `logdrift` mines every line of every run
into message templates, keeps compact statistics per template, and tells you what the failing run
*did differently*:

| finding | question it answers |
|---|---|
| **novel** | Which messages did the bad run print that no good run ever printed? |
| **vanished** | Which milestones did every good run reach that the bad run never did? |
| **progress** | How far through the baseline's milestones did the bad run get, and what was the first one it missed? |
| **frequency shift** | Which messages fire far more (or less) often than the good runs' envelope allows, after correcting for run length? |
| **parameter drift** | Same message, different values: `status` was always 200 and is now 503; `latency` p50 went 27ms → 4.75s; `node/20.18.0` became `node/22.11.0`. |
| **stalls** | Where did the bad run go silent for far longer than any good run did at that point? |
| **first divergence** | The exact line where the bad run first stepped off the known path, with context. |

It's a single static binary that uses only the Go standard library. It processes about 300k lines/s,
and baseline memory grows with the number of templates, not the number of lines.

```
$ logdrift good-1.log good-2.log bad.log

logdrift  baseline good-1.log, good-2.log (2 runs · 2,451 lines)   target bad.log (682 lines · 27 templates)

  DRIFT   9 novel · 5 vanished · 2 shifted · 3 param drift · 1 stall
          first divergence bad.log:8  first template never seen in baseline
          progress         reached 13/18 baseline milestones
            got as far as  L7 INFO connecting to redis addr=<IP> tls=true
            never reached  INFO redis connected in <DUR>

▌ NOVEL templates the baseline never produced
  L8       ×1  ✖ WARN redis tls handshake failed: x509: certificate has expired or is not yet valid
  L9       ×1    WARN cache disabled, falling back to direct postgres reads
  L34    ×291    WARN db pool exhausted, waiting for connection (waiters=<NUM>)
  L62      ×1  ✖ ERROR circuit breaker open for processor=stripe after <NUM> consecutive failures
  L677     ×1  ✖ ERROR panic: runtime error: invalid memory address or nil pointer dereference
  ...

▌ VANISHED every baseline run produced these; the target never did
  @1%       ×1  INFO redis connected in <DUR>
  @1%     ×400  DEBUG cache <*> key=customer:<NUM>
  @100%     ×1  INFO graceful shutdown complete in <DUR>
  ...

▌ SHIFTED frequency outside the baseline envelope
  ▼ ×13 vs 400  INFO charge authorized amount=<NUM> currency=USD processor=stripe
  ▲ ×54 vs 2–3  WARN retrying charge attempt=<NUM> backoff=<DUR>

▌ PARAMETER DRIFT same message, different values
  L11     INFO request id=<UUID> method=POST path=/v1/charges status=<NUM> latency=<DUR>
          latency: baseline p50 27ms · p95 55ms → target p50 4.75s · p95 5.63s (×176)
  L38     INFO request id=<UUID> method=POST path=/v1/charges status=<NUM> latency=<DUR>
          status: baseline {200 ×800} → new 503 ×287
  L127    INFO healthcheck ok uptime=<DUR> goroutines=<NUM>
          goroutines: baseline p50 46.5 · p95 52 → target p50 653 · p95 1029 (×14)

▌ STALLS silences far longer than any baseline gap at that point
  L62     +30.1s   ERROR circuit breaker open for processor=stripe after <NUM> conse… (baseline ≤59ms)

▌ AT THE DIVERGENCE bad.log
   7 │   2026-10-17T12:00:00.145Z INFO  connecting to redis addr=10.0.4.20:6379 tls=true
▶  8 │ N 2026-10-17T12:00:00.149Z WARN  redis tls handshake failed: x509: certificate has expired …
   9 │ N 2026-10-17T12:00:00.150Z WARN  cache disabled, falling back to direct postgres reads
```

The output reconstructs the incident from about 3,000 lines with no configuration. An expired Redis
certificate disabled the cache. Every request then hit Postgres, the connection pool saturated,
latency went up 176×, retries piled up, the payment processor's circuit breaker opened after a 30s
hang, goroutines leaked, and the process panicked instead of shutting down.

## Install

```sh
go install github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/cmd/logdrift@latest
# or, from a checkout:
cd logdrift && make build   # → ./bin/logdrift
```

## Usage

```
logdrift [diff] [flags] BASELINE... TARGET
logdrift templates [flags] FILE...
```

The last file is the target and every earlier file is a baseline. Pass `-` to read the target from
stdin. Gzip input is detected from the file contents, so the file name doesn't matter.

```sh
logdrift good.log bad.log                                  # terminal report
logdrift ci-pass-*.log ci-fail.log -f html -o drift.html   # interactive report
kubectl logs deploy/api | logdrift yesterday.log -         # live target from stdin
logdrift good.log bad.log -f md >> "$GITHUB_STEP_SUMMARY"  # CI job summary
logdrift good.log bad.log -f json | jq .summary            # machine-readable
logdrift templates app.log -n 20                           # just mine templates
```

| flag | default | meaning |
|---|---|---|
| `-f, --format` | `text` | `text`, `json`, `md`, `html` |
| `-o, --output` | stdout | write the report to a file |
| `-n, --top` | 10 | items per section |
| `-C, --context` | 4 | lines around the first divergence |
| `-i, --ignore REGEX` | | drop matching lines first (repeatable) |
| `--quorum F` | 1.0 | share of baselines a template must appear in to be "expected" |
| `--min-stall DUR` | 1s | shortest silence worth reporting |
| `-s, --sim F` | 0.5 | template similarity threshold |
| `--depth N` | 2 | leading tokens used to route templates |
| `--color WHEN` | auto | `auto`, `always`, `never` (honors `NO_COLOR`/`FORCE_COLOR`) |
| `--exit-zero` | | always exit 0 |

Exit status works like `diff(1)`: **0** means no drift, **1** means drift was found, and **2** means an error.
That makes it usable as a CI gate.

### Output formats

* **text**: the terminal report shown above, colored when stdout is a TTY.
* **html**: a self-contained page. It has a strip chart with one lane per finding type across the
  whole target run (click a cell to read the lines behind it), the log at the divergence, and a table
  for each finding type. Works offline and in light or dark mode.
* **md**: GitHub-flavored Markdown sized for a PR comment or `$GITHUB_STEP_SUMMARY`.
* **json**: everything, for tooling. See `internal/analyze/model.go` for the schema.

## How it works

```
 files ──► ingest ──► token ──► drain ──► analyze ──► report
           gunzip     mask      template   per-template     text / md /
           ANSI/\r    variables mining     stats + tests    html / json
           timestamps
```

1. **Ingest** (`internal/ingest`) streams each file, decompresses gzip, strips ANSI escape codes,
   keeps the final state of `\r` progress-bar redraws, truncates very long lines, and removes a
   leading timestamp (ISO-8601, syslog, clock time, or epoch) so it can be used for timing.
2. **Tokenize and mask** (`internal/token`). Each whitespace token is classified as a timestamp,
   UUID, IP, hex, duration, size, number, or mixed identifier, and replaced by a typed placeholder
   while its raw value is kept. `key=value` pairs keep their key (`latency=<DUR>`). Mixed identifiers
   keep their shape (`worker-<NUM>`, `service.go:<NUM>`). Short words with a numeric suffix such as
   `x509`, `sha256` and `http2` stay as they are.
3. **Mine templates** (`internal/drain`) with a Drain-style fixed-depth prefix tree shared by all runs,
   so template IDs line up across them. Changes from textbook Drain: typed placeholders compare as
   equal, `key=value` routing tokens route by key, and generalization keeps the key, so you get
   `mode=<*>` instead of a bare `<*>`.
4. **Accumulate** (`internal/analyze`) per template and per token position: counts per run, the first
   relative position of each template in each run, a bounded set of values with the runs that
   produced them, a deterministic reservoir sample of numeric values (with units converted), whether
   a value looks like a counter, the longest baseline silence before the template, and the set of
   adjacent template pairs. Baseline memory depends on the number of templates, not lines.
5. **Decide**. Each detector is conservative by design:
   * *Vanished*: if the template appeared the same number of times in every baseline run, it's a
     milestone and its absence is always reported. If the count varied between runs, absence is
     reported only when chance would explain it less than 1% of the time (Poisson,
     λ = expected count scaled to the target's length).
   * *Frequency shift*: the count must fall outside the baseline's min–max range by a wide margin,
     both in raw counts and after scaling for run length. A run that was simply shorter, for example
     because it crashed, doesn't produce a page of "decreased" findings.
   * *Categorical parameters*:
     * A slot that held the same literal word in every baseline line is part of the message text,
       so any change is reported.
     * A structured identifier (a version, a path) that at least two baseline runs agreed on is
       treated as configuration, so a change is reported.
     * Small recurring value sets are tested properly: new target values must be statistically
       surprising (binomial tail, p < 0.001) against the
       [Good–Turing](https://en.wikipedia.org/wiki/Good%E2%80%93Turing_frequency_estimation)
       estimate of how often the baseline itself produced unseen values.
     * With two or more baselines, values that only one run produced (PIDs, hostnames) are
       identities and are never compared.
   * *Numeric parameters*: the target median must be more than 2× the baseline p95 and 3× its median,
     or the mirror image for drops. Counters (`seq`, `uptime`) and identity keys (`pid`, `port`,
     `*_id`, ...) are skipped.
   * *Stalls*: the gap before a line must exceed both 3× the longest baseline gap before that
     template and `--min-stall`.
   * *New sequences* are reported but don't trigger a non-zero exit on their own, because
     concurrent logs interleave.

### False-positive budget

Healthy runs should come back `CLEAN`. The repository's generator was used to check this: 41
healthy service runs of varying length and 6 healthy CI runs, each compared against two baselines,
all came back clean. The same generator's failing runs were caught with the root cause as the first
divergence. More baselines help: two or more let `logdrift` tell identities (a PID) apart from
behavior (a status code).

## Examples

`examples/` contains two scenarios built by a deterministic generator (`go run ./examples/gen`):

* `good-*.log` / `bad.log`: a payments API whose Redis TLS certificate expired (shown above).
* `ci-pass-*.log` / `ci-fail.log`: a GitHub Actions jest run in which a Node.js upgrade makes one
  suite time out. `logdrift` puts the first divergence on line 2, `node/20.18.0` →
  `node/22.11.0`, before any test fails. It also reports that `PASS src/payments/refund.test.ts` and
  the build step vanished.

```sh
make demo      # text report for both scenarios
make demo-html # writes examples/report.html
```

## Development

```sh
make test      # go vet + race-enabled tests
make bench
make fuzz      # fuzz the tokenizer for 30s
go test ./internal/cli -update   # refresh the golden demo output
```

Layout:

```
cmd/logdrift/        entry point
internal/ingest/     streaming reader: gzip, ANSI, \r, timestamps
internal/token/      tokenizer + typed masking + unit-aware quantities
internal/drain/      template miner
internal/analyze/    statistics and detectors → Report
internal/report/     text, markdown, html (embedded template), json
internal/cli/        flag parsing, exit codes, golden tests
examples/            demo logs and their generator
```
