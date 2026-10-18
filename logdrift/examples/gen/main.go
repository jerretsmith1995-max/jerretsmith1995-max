// Command gen writes deterministic, realistic logs for a fictional
// "payments-api" service, used for logdrift's demo and end-to-end tests.
//
// The "good" scenario starts up, serves traffic and shuts down gracefully.
// The "bad" scenario is the same service on the day its Redis TLS
// certificate expired: the cache is disabled, every request hits Postgres,
// the pool saturates, latency explodes, retries pile up, the payment
// processor's circuit breaker opens after a long stall, and the process
// finally panics instead of shutting down.
//
//	go run ./examples/gen -scenario good -seed 1 > good-1.log
package main

import (
	"bufio"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"time"
)

func main() {
	scenario := flag.String("scenario", "good", "good, bad, ci-pass or ci-fail")
	seed := flag.Int64("seed", 1, "random seed")
	requests := flag.Int("requests", 400, "number of requests to simulate")
	flag.Parse()
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	g := &gen{w: w, r: rand.New(rand.NewSource(*seed)), now: time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC).Add(time.Duration(*seed) * time.Hour)}
	switch *scenario {
	case "good":
		g.run(*requests, false)
	case "bad":
		g.run(*requests, true)
	case "ci-pass":
		g.ci(false)
	case "ci-fail":
		g.ci(true)
	default:
		fmt.Fprintln(os.Stderr, "unknown scenario:", *scenario)
		os.Exit(2)
	}
}

type gen struct {
	w   *bufio.Writer
	r   *rand.Rand
	now time.Time
}

func (g *gen) log(level, format string, args ...any) {
	fmt.Fprintf(g.w, "%s %-5s %s\n", g.now.Format("2006-01-02T15:04:05.000Z"), level, fmt.Sprintf(format, args...))
}

func (g *gen) tick(min, max int) {
	g.now = g.now.Add(time.Duration(min+g.r.Intn(max-min+1)) * time.Millisecond)
}

func (g *gen) uuid() string {
	b := make([]byte, 16)
	g.r.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func (g *gen) run(requests int, broken bool) {
	pid := 4000 + g.r.Intn(5000)
	g.log("INFO", "starting payments-api version=2.14.1 commit=8f3a2c1d pid=%d", pid)
	g.tick(3, 9)
	g.log("INFO", "loaded config from /etc/payments/config.yaml (37 keys)")
	g.tick(5, 15)
	g.log("INFO", "connecting to postgres host=10.0.4.12:5432 db=payments pool=20")
	g.tick(30, 60)
	g.log("INFO", "postgres connected in %dms", 30+g.r.Intn(30))
	g.log("INFO", "running migrations")
	g.tick(80, 160)
	g.log("INFO", "migrations complete: 0 pending, schema version 118")
	g.log("INFO", "connecting to redis addr=10.0.4.20:6379 tls=true")
	g.tick(4, 12)
	cache := true
	if broken {
		g.log("WARN", "redis tls handshake failed: x509: certificate has expired or is not yet valid")
		g.tick(1, 3)
		g.log("WARN", "cache disabled, falling back to direct postgres reads")
		cache = false
	} else {
		g.log("INFO", "redis connected in %dms", 4+g.r.Intn(8))
	}
	g.log("INFO", "http server listening on :8080")

	waiters := 0
	failures := 0
	breakerOpen := false
	goroutines := 46
	for i := 0; i < requests; i++ {
		if broken && i == requests*3/4 {
			// The process dies before finishing its workload.
			g.tick(10, 30)
			g.log("ERROR", "panic: runtime error: invalid memory address or nil pointer dereference")
			fmt.Fprintln(g.w, "goroutine 1187 [running]:")
			fmt.Fprintln(g.w, "github.com/acme/payments/internal/charge.(*Service).Authorize(0x0, {0xc0001a2000, 0x24})")
			fmt.Fprintln(g.w, "\t/src/internal/charge/service.go:212 +0x3c")
			fmt.Fprintln(g.w, "github.com/acme/payments/internal/http.(*Handler).Charges(0xc000134000)")
			fmt.Fprintln(g.w, "\t/src/internal/http/handlers.go:88 +0x1f4")
			return
		}
		g.tick(5, 60)
		id := g.uuid()
		customer := 1000 + g.r.Intn(9000)
		latency := 12 + g.r.Intn(25)
		status := 200
		if cache {
			if g.r.Intn(10) < 8 {
				g.log("DEBUG", "cache hit key=customer:%d", customer)
			} else {
				g.log("DEBUG", "cache miss key=customer:%d", customer)
				latency += 15 + g.r.Intn(20)
			}
		} else {
			waiters = min(40, waiters+g.r.Intn(3))
			if waiters > 8 {
				g.log("WARN", "db pool exhausted, waiting for connection (waiters=%d)", waiters)
			}
			latency = 400 + g.r.Intn(1800) + waiters*90
			goroutines += 2 + g.r.Intn(4)
		}
		attempts := 1
		retryOdds := 120
		if broken {
			retryOdds = 6
		}
		for attempts < 4 && g.r.Intn(retryOdds) == 0 {
			attempts++
			g.log("WARN", "retrying charge attempt=%d backoff=%dms", attempts, 100*(1<<(attempts-2)))
			g.tick(50, 150)
		}
		if broken && latency > 2500 {
			status = 503
			failures++
		} else {
			failures = 0
		}
		if broken && failures >= 5 && !breakerOpen {
			// Upstream calls hang until the client-side timeout fires.
			g.now = g.now.Add(30*time.Second + time.Duration(g.r.Intn(900))*time.Millisecond)
			g.log("ERROR", "circuit breaker open for processor=stripe after %d consecutive failures", failures)
			breakerOpen = true
		}
		g.log("INFO", "request id=%s method=POST path=/v1/charges status=%d latency=%dms", id, status, latency)
		if status == 200 {
			g.log("INFO", "charge authorized amount=%d.%02d currency=USD processor=stripe", 5+g.r.Intn(400), g.r.Intn(100))
		}
		if g.r.Intn(150) == 0 {
			g.log("WARN", "slow query took %dms: SELECT * FROM charges WHERE customer_id = $1", 200+g.r.Intn(80))
		}
		if i%50 == 49 {
			if !broken {
				goroutines = 44 + g.r.Intn(9)
			}
			g.log("INFO", "healthcheck ok uptime=%ds goroutines=%d", i/5+10, goroutines)
		}
	}
	g.tick(100, 300)
	g.log("INFO", "received SIGTERM, draining connections")
	g.tick(50, 120)
	g.log("INFO", "drained 0 in-flight requests")
	g.log("INFO", "graceful shutdown complete in %dms", 100+g.r.Intn(60))
}

// ci writes a GitHub Actions-style job log for a TypeScript project: ANSI
// colors, 7-digit fractional timestamps, a jest run. The failing job runs on
// a newer Node.js whose fetch() no longer honors the test's mocked timers, so
// one suite hangs until jest's 5s timeout and fails.
func (g *gen) ci(broken bool) {
	ts := func() string { return g.now.Format("2006-01-02T15:04:05.0000000Z") }
	out := func(format string, args ...any) {
		fmt.Fprintf(g.w, "%s %s\n", ts(), fmt.Sprintf(format, args...))
	}
	node := "20.18.0"
	if broken {
		node = "22.11.0"
	}
	out("##[group]Run actions/setup-node@v4")
	g.tick(300, 900)
	out("Found in cache @ /opt/hostedtoolcache/node/%s/x64", node)
	out("##[endgroup]")
	out("##[group]Run npm ci")
	g.tick(9000, 15000)
	if broken {
		out("npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.")
	}
	out("added %d packages, and audited %d packages in %ds", 812, 813, 9+g.r.Intn(6))
	out("found 0 vulnerabilities")
	out("##[endgroup]")
	out("##[group]Run npm test -- --ci")
	out("> shop@3.2.0 test")
	out("> jest --ci")
	suites := []string{"cart/cart", "cart/pricing", "auth/session", "auth/tokens", "catalog/search", "catalog/facets",
		"payments/charge", "payments/refund", "orders/checkout", "orders/history", "users/profile", "users/addresses"}
	passed := 0
	for _, s := range suites {
		g.tick(400, 3500)
		dur := float64(400+g.r.Intn(3000)) / 1000
		if broken && s == "payments/refund" {
			g.now = g.now.Add(5 * time.Second)
			out("\x1b[0m\x1b[7m\x1b[1m\x1b[31m FAIL \x1b[39m\x1b[22m\x1b[27m\x1b[0m src/%s.test.ts (%.3f s)", s, dur+5)
			out("  \x1b[1m● refund › issues a partial refund after settlement\x1b[22m")
			out("    thrown: \"Exceeded timeout of 5000 ms for a test.")
			out("    Add a timeout value to this test to increase the timeout, if this is a long-running test.\"")
			out("      at Object.<anonymous> (src/payments/refund.test.ts:88:3)")
			passed += 17
			continue
		}
		out("\x1b[0m\x1b[7m\x1b[1m\x1b[32m PASS \x1b[39m\x1b[22m\x1b[27m\x1b[0m src/%s.test.ts (%.3f s)", s, dur)
		passed += 18
	}
	g.tick(200, 400)
	total := 18 * len(suites)
	if broken {
		out("\x1b[1mTest Suites: \x1b[22m\x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m, \x1b[1m\x1b[32m%d passed\x1b[39m\x1b[22m, %d total", len(suites)-1, len(suites))
		out("\x1b[1mTests:       \x1b[22m\x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m, \x1b[1m\x1b[32m%d passed\x1b[39m\x1b[22m, %d total", passed, total)
	} else {
		out("\x1b[1mTest Suites: \x1b[22m\x1b[1m\x1b[32m%d passed\x1b[39m\x1b[22m, %d total", len(suites), len(suites))
		out("\x1b[1mTests:       \x1b[22m\x1b[1m\x1b[32m%d passed\x1b[39m\x1b[22m, %d total", passed, total)
	}
	out("\x1b[1mTime:\x1b[22m        %.3f s", 20+g.r.Float64()*8)
	out("Ran all test suites.")
	if broken {
		out("##[error]Process completed with exit code 1.")
		return
	}
	out("##[endgroup]")
	out("##[group]Run npm run build")
	g.tick(4000, 9000)
	out("vite v5.4.10 building for production...")
	out("✓ %d modules transformed.", 1290+g.r.Intn(3))
	out("✓ built in %.2fs", 4+g.r.Float64()*3)
	out("##[endgroup]")
}
