package report

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"testing"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
)

func TestDuration(t *testing.T) {
	cases := map[float64]string{
		0: "0s", 0.0005: "500µs", 0.023: "23ms", 0.0125: "12.5ms", 4.75: "4.75s",
		30.1: "30.1s", 125: "2m05s", 3780: "1h03m",
	}
	for in, want := range cases {
		if got := Duration(in); got != want {
			t.Errorf("Duration(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestQuantityAndFactor(t *testing.T) {
	if got := Quantity(1536, "bytes"); got != "1.5KiB" {
		t.Errorf("bytes = %q", got)
	}
	if got := Quantity(46.5, ""); got != "46.5" {
		t.Errorf("plain = %q", got)
	}
	if got := Quantity(math.NaN(), ""); got != "n/a" {
		t.Errorf("nan = %q", got)
	}
	cases := map[float64]string{176: "×176", 1: "×1", 0.05: "÷20", math.Inf(1): "×∞", 0: "÷∞"}
	for in, want := range cases {
		if got := Factor(in); got != want {
			t.Errorf("Factor(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestSmallHelpers(t *testing.T) {
	if Thousands(1234567) != "1,234,567" || Thousands(-1200) != "-1,200" || Thousands(12) != "12" {
		t.Error("Thousands")
	}
	if Range(3, 3) != "3" || Range(2, 4) != "2–4" {
		t.Error("Range")
	}
	if Truncate("héllo world", 5) != "héll…" || Truncate("short", 10) != "short" {
		t.Error("Truncate")
	}
	if Plural(1, "run") != "1 run" || Plural(2, "run") != "2 runs" {
		t.Error("Plural")
	}
	if MarkCode(analyze.MarkParam|analyze.MarkNovel) != "N" || MarkCode(0) != " " {
		t.Error("MarkCode precedence")
	}
	if VerdictLine(analyze.Summary{}) != "no behavioral drift" {
		t.Error("clean verdict")
	}
	if got := VerdictLine(analyze.Summary{Novel: 2, Stalls: 1}); got != "2 novel · 1 stall" {
		t.Errorf("verdict = %q", got)
	}
}

func TestTopNovelPrefersErrors(t *testing.T) {
	all := []analyze.NovelTemplate{
		{Template: "a", FirstLine: 1}, {Template: "b", FirstLine: 2}, {Template: "boom", FirstLine: 3, Error: true},
		{Template: "c", FirstLine: 4}, {Template: "crash", FirstLine: 5, Error: true},
	}
	got := TopNovel(all, 3)
	var names []string
	for _, n := range got {
		names = append(names, n.Template)
	}
	if strings.Join(names, ",") != "a,boom,crash" {
		t.Fatalf("TopNovel = %v", names)
	}
}

// hostile builds a report whose every string field carries markup.
func hostile() *analyze.Report {
	evil := `</script><script>alert(1)</script><img src=x onerror=alert(2)> | ` + "`x`" + ` *y*`
	return &analyze.Report{
		Baselines: []analyze.RunSummary{{Name: evil, Lines: 3}},
		Target:    analyze.RunSummary{Name: evil, Lines: 3},
		Templates: 1,
		Summary:   analyze.Summary{Drift: true, Novel: 1, FirstDivergence: &analyze.Divergence{Line: 1, Reason: "r", Text: evil}},
		Novel:     []analyze.NovelTemplate{{Template: evil + " <NUM>", Count: 1, FirstLine: 1, Error: true, Sample: evil}},
		Vanished:  []analyze.VanishedTemplate{{Template: evil, BaseCounts: []int{1}, Sample: evil}},
		ParamDrift: []analyze.ParamDrift{{Template: evil, Slot: evil, Kind: "categorical", FirstLine: 1,
			BaseValues: []analyze.ValueCount{{Value: evil, Count: 3}}, NewValues: []analyze.ValueCount{{Value: evil, Count: 1}}}},
		Progress:  &analyze.Progress{Expected: 1, FirstMissed: evil, LastReached: evil, LastReachedLine: 1},
		Context:   []analyze.ContextLine{{Line: 1, Text: evil, Marks: analyze.MarkNovel, Focus: true}},
		LineMarks: []uint8{analyze.MarkNovel, 0, analyze.MarkStall},
		LineNos:   []int{1, 2, 3},
		Marked:    []analyze.ContextLine{{Line: 1, Text: evil, Marks: analyze.MarkNovel}},
	}
}

func TestHTMLEscapesEverything(t *testing.T) {
	var buf bytes.Buffer
	if err := HTML(&buf, hostile(), Options{Version: "test"}); err != nil {
		t.Fatal(err)
	}
	h := buf.String()
	if strings.Contains(h, "<script>alert") || strings.Contains(h, "<img src=x") {
		t.Fatal("unescaped markup in HTML report")
	}
	if n := strings.Count(h, "</script>"); n != 2 {
		t.Fatalf("expected exactly 2 closing script tags (data + code), found %d", n)
	}
	// placeholders are still highlighted
	if !strings.Contains(h, `<span class="ph">&lt;NUM&gt;</span>`) {
		t.Fatal("placeholder highlighting missing")
	}
	// the embedded payload is valid JSON
	start := strings.Index(h, `id="logdrift-data">`) + len(`id="logdrift-data">`)
	end := strings.Index(h[start:], "</script>")
	var payload struct {
		Lines []struct {
			L int    `json:"l"`
			T string `json:"t"`
		} `json:"lines"`
	}
	if err := json.Unmarshal([]byte(h[start:start+end]), &payload); err != nil {
		t.Fatalf("payload: %v\n%s", err, h[start:start+end])
	}
	if len(payload.Lines) != 1 || !strings.Contains(payload.Lines[0].T, "alert(1)") {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestMarkdownEscapes(t *testing.T) {
	var buf bytes.Buffer
	if err := Markdown(&buf, hostile(), Options{}); err != nil {
		t.Fatal(err)
	}
	md := buf.String()
	// Markup is inert inside code spans and fenced blocks; check everything else.
	var prose []string
	fenced := false
	for _, line := range strings.Split(md, "\n") {
		if strings.HasPrefix(line, "```") {
			fenced = !fenced
			continue
		}
		if !fenced {
			prose = append(prose, codeSpanRe.ReplaceAllString(line, ""))
		}
	}
	if p := strings.Join(prose, "\n"); strings.Contains(p, "<script>") || strings.Contains(p, "<img") {
		t.Fatalf("raw HTML leaked into markdown prose:\n%s", p)
	}
	for _, line := range strings.Split(md, "\n") {
		if !strings.HasPrefix(line, "| ") {
			continue
		}
		// every unescaped pipe is a cell border: rows in one table must agree
		cells := len(strings.Split(strings.ReplaceAll(line, `\|`, ""), "|"))
		if cells < 4 || cells > 6 {
			t.Errorf("table row broken by content: %s", line)
		}
	}
}

var codeSpanRe = regexp.MustCompile("``.*?``|`[^`]*`")

func TestCodeSpan(t *testing.T) {
	if got := code("a`b"); got != "``a`b``" {
		t.Errorf("code = %q", got)
	}
	if got := code("`x`"); got != "`` `x` ``" {
		t.Errorf("code = %q", got)
	}
}

func TestTextRendersWithoutColorCodes(t *testing.T) {
	var buf bytes.Buffer
	if err := Text(&buf, hostile(), Options{Width: 80}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "\x1b[") {
		t.Fatal("ANSI codes in colorless output")
	}
	buf.Reset()
	Text(&buf, hostile(), Options{Width: 80, Color: true})
	if !strings.Contains(buf.String(), "\x1b[") {
		t.Fatal("no ANSI codes in color output")
	}
}

func TestJSONIsStable(t *testing.T) {
	var a, b bytes.Buffer
	JSON(&a, hostile(), Options{Version: "v"})
	JSON(&b, hostile(), Options{Version: "v"})
	if a.String() != b.String() {
		t.Fatal("JSON output not deterministic")
	}
	if strings.Contains(a.String(), "line_marks") {
		t.Fatal("internal timeline data leaked into JSON")
	}
}

func TestEmptyReportRenders(t *testing.T) {
	r := &analyze.Report{}
	for name, f := range map[string]func(*bytes.Buffer) error{
		"text": func(b *bytes.Buffer) error { return Text(b, r, Options{}) },
		"md":   func(b *bytes.Buffer) error { return Markdown(b, r, Options{}) },
		"html": func(b *bytes.Buffer) error { return HTML(b, r, Options{}) },
		"json": func(b *bytes.Buffer) error { return JSON(b, r, Options{}) },
	} {
		var buf bytes.Buffer
		if err := f(&buf); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}
