package drain

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/token"
)

func toks(s string) []string {
	var out []string
	for _, t := range token.Tokenize(s, nil) {
		out = append(out, t.Text)
	}
	return out
}

func TestClustersSameShape(t *testing.T) {
	m := New(DefaultConfig)
	a := m.Add(toks("login ok user alice from 10.0.0.1"))
	b := m.Add(toks("login ok user bob from 10.0.0.2"))
	if a.ID != b.ID {
		t.Fatalf("expected one cluster, got %d and %d", a.ID, b.ID)
	}
	if got, want := a.Template(), "login ok user <*> from <IP>"; got != want {
		t.Fatalf("template = %q, want %q", got, want)
	}
	if a.Size != 2 {
		t.Fatalf("size = %d", a.Size)
	}
}

func TestSeparatesDifferentMessages(t *testing.T) {
	m := New(DefaultConfig)
	a := m.Add(toks("INFO connected to database primary"))
	b := m.Add(toks("ERROR connection to database refused"))
	c := m.Add(toks("INFO connected to cache primary"))
	if a.ID == b.ID {
		t.Fatal("INFO and ERROR lines must not share a cluster (different routing token)")
	}
	if a.ID != c.ID {
		t.Fatal("near-identical INFO lines should share a cluster")
	}
	if len(m.Clusters()) != 2 {
		t.Fatalf("clusters = %d", len(m.Clusters()))
	}
}

func TestRoutingWordsSeparateEvents(t *testing.T) {
	m := New(DefaultConfig)
	a := m.Add(toks("INFO postgres connected in 40ms"))
	b := m.Add(toks("INFO redis connected in 8ms"))
	if a.ID == b.ID {
		t.Fatal("different components in a routing position should stay separate milestones")
	}
	c := m.Add(toks("level=info msg=started"))
	d := m.Add(toks("level=warn msg=started"))
	if c.ID != d.ID || c.Template() != "level=<*> msg=started" {
		t.Fatalf("keyed routing tokens should route by key: %q / %q", c.Template(), d.Template())
	}
}

func TestLengthSeparates(t *testing.T) {
	m := New(DefaultConfig)
	a := m.Add(toks("a b c"))
	b := m.Add(toks("a b c d"))
	if a.ID == b.ID {
		t.Fatal("different token counts must not merge")
	}
}

func TestKeyedWildcard(t *testing.T) {
	m := New(DefaultConfig)
	m.Add(toks("cache mode=fast ready"))
	c := m.Add(toks("cache mode=slow ready"))
	if got, want := c.Template(), "cache mode=<*> ready"; got != want {
		t.Fatalf("template = %q, want %q", got, want)
	}
	// A third value keeps the keyed wildcard.
	c = m.Add(toks("cache mode=off ready"))
	if got, want := c.Template(), "cache mode=<*> ready"; got != want {
		t.Fatalf("template = %q, want %q", got, want)
	}
}

func TestGeneralize(t *testing.T) {
	cases := [][3]string{
		{"a", "a", "a"},
		{"a", "b", "<*>"},
		{"k=1", "k=2", "k=<*>"},
		{"k=<*>", "k=zz", "k=<*>"},
		{"k=1", "j=1", "<*>"},
		{"<*>", "x", "<*>"},
	}
	for _, c := range cases {
		if got := Generalize(c[0], c[1]); got != c[2] {
			t.Errorf("Generalize(%q, %q) = %q, want %q", c[0], c[1], got, c[2])
		}
	}
}

func TestSimilarityThreshold(t *testing.T) {
	strict := New(Config{Similarity: 0.9})
	a := strict.Add(toks("job finished one ok"))
	b := strict.Add(toks("job finished two badly"))
	if a.ID == b.ID {
		t.Fatal("with sim 0.9, half-matching lines must not merge")
	}
	loose := New(Config{Similarity: 0.4})
	a = loose.Add(toks("job finished one ok"))
	b = loose.Add(toks("job finished two badly"))
	if a.ID != b.ID {
		t.Fatal("with sim 0.4, half-matching lines should merge")
	}
}

func TestMaxChildrenOverflow(t *testing.T) {
	m := New(Config{MaxChildren: 3, Depth: 1})
	for i := 0; i < 10; i++ {
		m.Add([]string{fmt.Sprintf("word%c", 'a'+i), "tail", "end"})
	}
	// The first 2 distinct heads get their own branch; the rest share the wildcard branch
	// and merge there because "tail end" matches.
	if n := len(m.Clusters()); n > 4 {
		t.Fatalf("clusters = %d, overflow routing did not kick in", n)
	}
}

func TestMatchDoesNotMutate(t *testing.T) {
	m := New(DefaultConfig)
	m.Add(toks("disk usage 40% on /var"))
	before := m.Clusters()[0].Template()
	c := m.Match(toks("disk usage 95% on /data"))
	if c == nil {
		t.Fatal("expected a match")
	}
	if m.Clusters()[0].Template() != before || c.Size != 1 {
		t.Fatal("Match modified the cluster")
	}
	if m.Match(toks("completely different line here now")) != nil {
		t.Fatal("unexpected match")
	}
}

func TestDeterministic(t *testing.T) {
	lines := []string{
		"GET /a 200 12ms", "GET /b 404 3ms", "POST /a 201 40ms", "worker 3 started",
		"worker 7 started", "worker 3 stopped", "GET /c 200 9ms",
	}
	render := func() string {
		m := New(DefaultConfig)
		for _, l := range lines {
			m.Add(toks(l))
		}
		var b strings.Builder
		for _, c := range m.Clusters() {
			fmt.Fprintf(&b, "%d %s\n", c.Size, c.Template())
		}
		return b.String()
	}
	first := render()
	for i := 0; i < 5; i++ {
		if got := render(); got != first {
			t.Fatalf("non-deterministic clustering:\n%s\nvs\n%s", first, got)
		}
	}
}

func BenchmarkAdd(b *testing.B) {
	lines := make([][]string, 64)
	for i := range lines {
		lines[i] = toks(fmt.Sprintf("INFO request id=%d method=POST path=/v1/r%d status=%d latency=%dms", i, i%7, 200+i%3, i))
	}
	m := New(DefaultConfig)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Add(lines[i%len(lines)])
	}
}
