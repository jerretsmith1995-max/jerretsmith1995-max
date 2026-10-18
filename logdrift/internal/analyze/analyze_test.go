package analyze

import (
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/ingest"
)

// run is a log described as lines; each line may start with "+<duration> "
// to advance the clock before it (default 10ms).
type run []string

func render(lines run) string {
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var b strings.Builder
	for _, l := range lines {
		step := 10 * time.Millisecond
		if strings.HasPrefix(l, "+") {
			sp := strings.IndexByte(l, ' ')
			d, err := time.ParseDuration(l[1:sp])
			if err != nil {
				panic(err)
			}
			step, l = d, l[sp+1:]
		}
		clock = clock.Add(step)
		fmt.Fprintf(&b, "%s %s\n", clock.Format("2006-01-02T15:04:05.000Z"), l)
	}
	return b.String()
}

func analyze(t *testing.T, opts Options, target run, baselines ...run) *Report {
	t.Helper()
	e := New(opts)
	for i, b := range baselines {
		if err := e.BeginBaseline(fmt.Sprintf("base%d", i+1)); err != nil {
			t.Fatal(err)
		}
		feed(t, e, render(b))
	}
	if err := e.BeginTarget("target"); err != nil {
		t.Fatal(err)
	}
	feed(t, e, render(target))
	return e.Report()
}

func feed(t *testing.T, e *Engine, s string) {
	t.Helper()
	err := ingest.Scan(strings.NewReader(s), ingest.Options{}, func(r ingest.Record) error { e.Add(r); return nil })
	if err != nil {
		t.Fatal(err)
	}
}

func repeat(n int, f func(i int) string) run {
	out := make(run, n)
	for i := range out {
		out[i] = f(i)
	}
	return out
}

func concat(parts ...run) run {
	var out run
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// service builds a small, realistic run.
func service(requests int, status func(i int) int, latency func(i int) string) run {
	return concat(
		run{"INFO starting api version=1.4.2", "INFO postgres connected in 40ms", "INFO redis connected in 8ms", "INFO listening on :8080"},
		repeat(requests, func(i int) string {
			return fmt.Sprintf("INFO request id=%d status=%d latency=%s", 1000+i, status(i), latency(i))
		}),
		run{"INFO shutdown complete"},
	)
}

func ok(int) int { return 200 }
func fast(i int) string {
	return fmt.Sprintf("%dms", 10+(i*7)%30)
}

func TestIdenticalRunsAreClean(t *testing.T) {
	r := analyze(t, Options{}, service(50, ok, fast), service(50, ok, fast), service(60, ok, fast))
	if r.Summary.Drift {
		t.Fatalf("expected no drift, got %+v", r.Summary)
	}
	if r.Summary.FirstDivergence != nil || len(r.Context) != 0 {
		t.Fatal("a clean report must not point at a divergence")
	}
	if r.Progress == nil || r.Progress.Reached != r.Progress.Expected {
		t.Fatalf("progress = %+v", r.Progress)
	}
}

func TestNovelAndFirstDivergence(t *testing.T) {
	target := service(20, ok, fast)
	target = concat(target[:10], run{"ERROR disk quota exceeded on /data"}, target[10:])
	r := analyze(t, Options{}, target, service(20, ok, fast))
	if len(r.Novel) != 1 {
		t.Fatalf("novel = %+v", r.Novel)
	}
	n := r.Novel[0]
	if !n.Error || n.FirstLine != 11 || n.Count != 1 {
		t.Fatalf("novel = %+v", n)
	}
	d := r.Summary.FirstDivergence
	if d == nil || d.Line != 11 || !strings.Contains(d.Text, "disk quota") {
		t.Fatalf("divergence = %+v", d)
	}
	var focus *ContextLine
	for i := range r.Context {
		if r.Context[i].Focus {
			focus = &r.Context[i]
		}
	}
	if focus == nil || focus.Line != 11 || focus.Marks&MarkNovel == 0 {
		t.Fatalf("context focus = %+v", focus)
	}
}

func TestVanishedMilestoneAndProgress(t *testing.T) {
	base := service(30, ok, fast)
	// the target never reaches redis and never shuts down
	target := concat(base[:2], base[3:len(base)-1])
	r := analyze(t, Options{}, target, base, service(30, ok, fast))
	var got []string
	for _, v := range r.Vanished {
		got = append(got, v.Template)
	}
	want := []string{"INFO redis connected in <DUR>", "INFO shutdown complete"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("vanished = %q, want %q (in baseline order)", got, want)
	}
	p := r.Progress
	if p.FirstMissed != want[0] || p.LastReached != "INFO postgres connected in <DUR>" || p.LastReachedLine != 2 {
		t.Fatalf("progress = %+v", p)
	}
}

func TestSporadicAbsenceIsNotVanished(t *testing.T) {
	withRetries := func(n int) run {
		r := service(40, ok, fast)
		for i := 0; i < n; i++ {
			r = append(r, fmt.Sprintf("WARN retrying call attempt=%d", 2))
		}
		return r
	}
	// counts vary across baselines (2 vs 3): sporadic, so zero in the target is plausible
	r := analyze(t, Options{}, service(40, ok, fast), withRetries(2), withRetries(3))
	if len(r.Vanished) != 0 {
		t.Fatalf("sporadic template reported as vanished: %+v", r.Vanished)
	}
	// but a sporadic template that normally fires ~30 times is missed
	r = analyze(t, Options{}, service(40, ok, fast), withRetries(28), withRetries(31))
	if len(r.Vanished) != 1 {
		t.Fatalf("frequent template absence not reported: %+v", r.Vanished)
	}
}

func TestFrequencyShift(t *testing.T) {
	retries := func(n int) run {
		return repeat(n, func(i int) string { return "WARN upstream slow, retrying" })
	}
	base1 := concat(service(100, ok, fast), retries(2))
	base2 := concat(service(100, ok, fast), retries(3))
	target := concat(service(100, ok, fast), retries(40))
	r := analyze(t, Options{}, target, base1, base2)
	if len(r.Shifted) != 1 {
		t.Fatalf("shifted = %+v", r.Shifted)
	}
	s := r.Shifted[0]
	if s.Direction != "up" || s.Target != 40 || s.BaseMin != 2 || s.BaseMax != 3 {
		t.Fatalf("shift = %+v", s)
	}
}

func TestTruncatedTargetIsNotADecrease(t *testing.T) {
	// A target that simply ran shorter must not report every per-request
	// template as decreased.
	r := analyze(t, Options{}, service(20, ok, fast), service(200, ok, fast), service(200, ok, fast))
	for _, s := range r.Shifted {
		if s.Direction == "down" {
			t.Fatalf("length-normalized decrease misreported: %+v", s)
		}
	}
}

func TestCategoricalParamDrift(t *testing.T) {
	bad := func(i int) int {
		if i%3 == 0 {
			return 503
		}
		return 200
	}
	r := analyze(t, Options{}, service(60, bad, fast), service(60, ok, fast), service(60, ok, fast))
	pd := findParam(r, "status")
	if pd == nil {
		t.Fatalf("no status drift in %+v", r.ParamDrift)
	}
	if pd.Kind != "categorical" || pd.NewCount != 20 || pd.NewValues[0].Value != "503" || pd.FirstLine != 5 {
		t.Fatalf("status drift = %+v", pd)
	}
}

func TestNumericParamDrift(t *testing.T) {
	slow := func(i int) string { return fmt.Sprintf("%.1fs", 3+float64(i%5)/2) }
	r := analyze(t, Options{}, service(60, ok, slow), service(60, ok, fast), service(60, ok, fast))
	pd := findParam(r, "latency")
	if pd == nil {
		t.Fatalf("no latency drift in %+v", r.ParamDrift)
	}
	if pd.Kind != "numeric" || pd.Dimension != "time" || pd.Factor < 50 {
		t.Fatalf("latency drift = %+v", pd)
	}
	if pd.BaseP50 > 0.05 || pd.TargetP50 < 3 {
		t.Fatalf("quantiles = %v → %v", pd.BaseP50, pd.TargetP50)
	}
}

func TestConstantWordChange(t *testing.T) {
	base := run{"INFO starting", "INFO connecting to redis tls=true", "INFO ready"}
	target := run{"INFO starting", "INFO connecting to redis tls=false", "INFO ready"}
	r := analyze(t, Options{}, target, base, base)
	pd := findParam(r, "tls")
	if pd == nil || pd.NewValues[0].Value != "false" || pd.FirstLine != 2 {
		t.Fatalf("tls change not detected: %+v", r.ParamDrift)
	}
}

func TestVersionChange(t *testing.T) {
	mk := func(v string) run {
		return run{"INFO setup", "INFO found in cache @ /opt/tool/node/" + v + "/x64", "INFO done"}
	}
	r := analyze(t, Options{}, mk("22.11.0"), mk("20.18.0"), mk("20.18.0"))
	if len(r.ParamDrift) != 1 || r.ParamDrift[0].NewValues[0].Value != "/opt/tool/node/22.11.0/x64" {
		t.Fatalf("version change not detected: %+v", r.ParamDrift)
	}
	// with a single baseline the same shape could be a per-run name: stay quiet
	r = analyze(t, Options{}, mk("22.11.0"), mk("20.18.0"))
	if len(r.ParamDrift) != 0 {
		t.Fatalf("single-baseline identifier flagged: %+v", r.ParamDrift)
	}
}

func TestIdentitiesAndCountersAreIgnored(t *testing.T) {
	mk := func(pid, n int) run {
		return concat(
			run{fmt.Sprintf("INFO boot pid=%d", pid)},
			repeat(n, func(i int) string {
				return fmt.Sprintf("INFO tick seq=%d uptime=%ds worker=w%d", i, i*5, pid%7)
			}),
		)
	}
	r := analyze(t, Options{}, mk(999, 30), mk(111, 60), mk(222, 60))
	if len(r.ParamDrift) != 0 {
		t.Fatalf("identity/counter slots flagged: %+v", r.ParamDrift)
	}
}

func TestRareRetryValueIsNotSignificant(t *testing.T) {
	retry := func(attempts ...int) run {
		var out run
		for _, a := range attempts {
			out = append(out, fmt.Sprintf("WARN retrying charge attempt=%d", a))
		}
		return out
	}
	base1 := concat(service(50, ok, fast), retry(2, 2, 2))
	base2 := concat(service(50, ok, fast), retry(2, 2))
	target := concat(service(50, ok, fast), retry(2, 3))
	r := analyze(t, Options{}, target, base1, base2)
	if findParam(r, "attempt") != nil {
		t.Fatalf("a single unseen value after 5 samples must not be significant: %+v", r.ParamDrift)
	}
}

func TestStall(t *testing.T) {
	base := run{"INFO a", "INFO b", "INFO c", "INFO d"}
	target := run{"INFO a", "INFO b", "+45s INFO c", "INFO d"}
	r := analyze(t, Options{}, target, base, base)
	if len(r.Stalls) != 1 {
		t.Fatalf("stalls = %+v", r.Stalls)
	}
	s := r.Stalls[0]
	if s.Line != 3 || math.Abs(s.Gap-45) > 0.001 || s.Template != "INFO c" {
		t.Fatalf("stall = %+v", s)
	}
	// A long gap that the baseline also has is normal.
	base2 := run{"INFO a", "INFO b", "+40s INFO c", "INFO d"}
	r = analyze(t, Options{}, target, base2, base2)
	if len(r.Stalls) != 0 {
		t.Fatalf("expected gap reported as stall: %+v", r.Stalls)
	}
}

func TestNovelTransitionsAreWeak(t *testing.T) {
	base := run{"INFO alpha", "INFO beta", "INFO gamma"}
	target := run{"INFO alpha", "INFO gamma", "INFO beta"}
	r := analyze(t, Options{}, target, base, base)
	if r.Summary.Drift {
		t.Fatalf("reordering alone must not count as drift: %+v", r.Summary)
	}
	if r.Summary.NovelTransitions != 2 || len(r.Transitions) != 2 {
		t.Fatalf("transitions = %d %+v", r.Summary.NovelTransitions, r.Transitions)
	}
}

func TestQuorum(t *testing.T) {
	with := run{"INFO a", "INFO optional thing", "INFO b"}
	without := run{"INFO a", "INFO b"}
	// present in 2 of 3 baselines: expected only with quorum <= 2/3
	r := analyze(t, Options{}, without, with, with, without)
	if len(r.Vanished) != 0 {
		t.Fatalf("default quorum should require all baselines: %+v", r.Vanished)
	}
	r = analyze(t, Options{Quorum: 0.6}, without, with, with, without)
	if len(r.Vanished) != 1 {
		t.Fatalf("quorum 0.6 should expect the template: %+v", r.Vanished)
	}
}

func TestOrderEnforced(t *testing.T) {
	e := New(Options{})
	e.BeginTarget("t")
	if err := e.BeginBaseline("b"); err != ErrOrder {
		t.Fatalf("err = %v", err)
	}
	if err := e.BeginTarget("again"); err == nil {
		t.Fatal("second target accepted")
	}
}

func TestEmptyInputs(t *testing.T) {
	r := analyze(t, Options{}, run{}, run{})
	if r.Summary.Drift || r.Templates != 0 {
		t.Fatalf("empty: %+v", r.Summary)
	}
	r = analyze(t, Options{}, run{"INFO only target"}, run{})
	if len(r.Novel) != 1 {
		t.Fatalf("novel on empty baseline = %+v", r.Novel)
	}
}

func TestTemplates(t *testing.T) {
	e := New(Options{})
	e.BeginBaseline("a")
	feed(t, e, render(service(5, ok, fast)))
	ts := e.Templates()
	found := false
	for _, x := range ts {
		if x.Template == "INFO request id=<NUM> status=<NUM> latency=<DUR>" && x.Count == 5 {
			found = true
		}
	}
	if !found {
		t.Fatalf("templates = %+v", ts)
	}
}

func TestBinomTail(t *testing.T) {
	cases := []struct {
		n, k int
		p    float64
		want float64
	}{
		{10, 0, 0.5, 1},
		{10, 10, 0.5, math.Pow(0.5, 10)},
		{10, 11, 0.5, 0},
		{4, 3, 0.5, 5.0 / 16},
		{600, 287, 1.0 / 802, 0},
	}
	for _, c := range cases {
		got := binomTail(c.n, c.k, c.p)
		if math.Abs(got-c.want) > 1e-9 {
			t.Errorf("binomTail(%d,%d,%v) = %v, want %v", c.n, c.k, c.p, got, c.want)
		}
	}
}

func TestQuantile(t *testing.T) {
	xs := []float64{1, 2, 3, 4}
	if q := quantile(xs, 0.5); q != 2.5 {
		t.Fatalf("median = %v", q)
	}
	if !math.IsNaN(quantile(nil, 0.5)) {
		t.Fatal("empty quantile should be NaN")
	}
}

func findParam(r *Report, slot string) *ParamDrift {
	for i := range r.ParamDrift {
		if r.ParamDrift[i].Slot == slot {
			return &r.ParamDrift[i]
		}
	}
	return nil
}

func BenchmarkEngine(b *testing.B) {
	base := render(service(5000, ok, fast))
	target := render(service(5000, func(i int) int {
		if i%10 == 0 {
			return 500
		}
		return 200
	}, fast))
	b.SetBytes(int64(len(base) + len(target)))
	for i := 0; i < b.N; i++ {
		e := New(Options{})
		e.BeginBaseline("b")
		ingest.Scan(strings.NewReader(base), ingest.Options{}, func(r ingest.Record) error { e.Add(r); return nil })
		e.BeginTarget("t")
		ingest.Scan(strings.NewReader(target), ingest.Options{}, func(r ingest.Record) error { e.Add(r); return nil })
		e.Report()
	}
}
