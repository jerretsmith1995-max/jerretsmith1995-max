package cli

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

const examples = "../../examples/"

func run(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	t.Setenv("COLUMNS", "120")
	t.Setenv("NO_COLOR", "")
	t.Setenv("FORCE_COLOR", "")
	var out, errb bytes.Buffer
	code := Main(args, &out, &errb)
	return code, out.String(), errb.String()
}

func demoArgs(extra ...string) []string {
	return append([]string{examples + "good-1.log", examples + "good-2.log", examples + "bad.log"}, extra...)
}

func TestDemoGoldenText(t *testing.T) {
	code, out, errs := run(t, demoArgs("--color", "never")...)
	if code != ExitDrift || errs != "" {
		t.Fatalf("exit %d, stderr %q", code, errs)
	}
	golden := filepath.Join("testdata", "demo.txt")
	if *update {
		os.MkdirAll("testdata", 0o755)
		if err := os.WriteFile(golden, []byte(out), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("%v (run go test ./internal/cli -update)", err)
	}
	if out != string(want) {
		t.Errorf("text report changed; run `go test ./internal/cli -update` if intended.\n--- got ---\n%s", out)
	}
}

func TestDemoJSON(t *testing.T) {
	code, out, _ := run(t, demoArgs("-f", "json")...)
	if code != ExitDrift {
		t.Fatalf("exit %d", code)
	}
	var r struct {
		Tool    string `json:"tool"`
		Summary struct {
			Drift           bool `json:"drift"`
			Novel           int  `json:"novel"`
			FirstDivergence struct {
				Line int `json:"line"`
			} `json:"first_divergence"`
		} `json:"summary"`
		Progress struct {
			FirstMissed string `json:"first_missed"`
		} `json:"progress"`
		ParamDrift []struct {
			Slot string `json:"slot"`
		} `json:"param_drift"`
		Stalls []struct {
			Gap float64 `json:"gap_seconds"`
		} `json:"stalls"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		t.Fatal(err)
	}
	if r.Tool != "logdrift" || !r.Summary.Drift || r.Summary.FirstDivergence.Line != 8 {
		t.Fatalf("summary = %+v", r.Summary)
	}
	if r.Progress.FirstMissed != "INFO redis connected in <DUR>" {
		t.Fatalf("first missed = %q", r.Progress.FirstMissed)
	}
	slots := map[string]bool{}
	for _, p := range r.ParamDrift {
		slots[p.Slot] = true
	}
	for _, s := range []string{"latency", "status", "goroutines"} {
		if !slots[s] {
			t.Errorf("missing param drift on %s: %+v", s, r.ParamDrift)
		}
	}
	if len(r.Stalls) != 1 || r.Stalls[0].Gap < 30 {
		t.Fatalf("stalls = %+v", r.Stalls)
	}
}

func TestDemoMarkdownAndHTML(t *testing.T) {
	_, md, _ := run(t, demoArgs("-f", "md")...)
	for _, want := range []string{"### 🔴 logdrift:", "**First divergence:** line 8", "#### Parameter drift", "| 38 | `status` |"} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown missing %q", want)
		}
	}
	dir := t.TempDir()
	out := filepath.Join(dir, "r.html")
	code, stdout, _ := run(t, demoArgs("-f", "html", "-o", out)...)
	if code != ExitDrift || stdout != "" {
		t.Fatalf("exit %d stdout %q", code, stdout)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	h := string(b)
	for _, want := range []string{"<!doctype html>", `id="logdrift-data"`, "Never reached", `class="lane"`, "redis tls handshake failed"} {
		if !strings.Contains(h, want) {
			t.Errorf("html missing %q", want)
		}
	}
}

func TestCleanExitZero(t *testing.T) {
	code, out, _ := run(t, examples+"good-1.log", examples+"good-2.log", "--color=never")
	if code != ExitClean || !strings.Contains(out, "CLEAN") {
		t.Fatalf("exit %d\n%s", code, out)
	}
}

func TestExitZeroFlag(t *testing.T) {
	if code, _, _ := run(t, demoArgs("--exit-zero", "-f", "json")...); code != ExitClean {
		t.Fatalf("exit %d", code)
	}
}

func TestStdinTarget(t *testing.T) {
	f, err := os.Open(examples + "bad.log")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	old := os.Stdin
	os.Stdin = f
	defer func() { os.Stdin = old }()
	code, out, _ := run(t, examples+"good-1.log", "-", "-f", "json")
	if code != ExitDrift || !strings.Contains(out, `"name": "stdin"`) {
		t.Fatalf("exit %d\n%s", code, out[:min(len(out), 400)])
	}
}

func TestGzipBaseline(t *testing.T) {
	raw, err := os.ReadFile(examples + "good-1.log")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(raw)
	zw.Close()
	gz := filepath.Join(t.TempDir(), "good-1.log.gz")
	os.WriteFile(gz, buf.Bytes(), 0o644)
	code, _, errs := run(t, gz, examples+"good-2.log", "-f", "json")
	if code != ExitClean {
		t.Fatalf("exit %d %s", code, errs)
	}
}

func TestTemplatesCommand(t *testing.T) {
	code, out, _ := run(t, "templates", examples+"good-1.log", "-n", "3", "--color", "never")
	if code != ExitClean {
		t.Fatalf("exit %d", code)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 3 || !strings.Contains(out, "INFO request id=<UUID>") || !strings.HasPrefix(lines[0], "400  ") {
		t.Fatalf("templates output:\n%s", out)
	}
	code, out, _ = run(t, "templates", "-f", "json", examples+"bad.log")
	var ts []map[string]any
	if code != ExitClean || json.Unmarshal([]byte(out), &ts) != nil || len(ts) == 0 {
		t.Fatalf("json templates: %d %s", code, out)
	}
}

func TestIgnoreFlag(t *testing.T) {
	_, out, _ := run(t, demoArgs("-f", "json", "-i", "redis", "--ignore=goroutine|github|/src/")...)
	if strings.Contains(out, "redis") {
		t.Fatal("ignored lines leaked into the report")
	}
}

func TestErrors(t *testing.T) {
	cases := []struct {
		args []string
		msg  string
	}{
		{[]string{examples + "good-1.log"}, "at least one baseline"},
		{[]string{"a", "b", "--format", "xml"}, "unknown format"},
		{[]string{"a", "b", "--bogus"}, "unknown flag"},
		{[]string{"a", "b", "-n"}, "needs a value"},
		{[]string{"a", "b", "-n", "0"}, "positive integer"},
		{[]string{"a", "b", "--sim", "2"}, "(0, 1]"},
		{[]string{"a", "b", "--min-stall", "soon"}, "duration"},
		{[]string{"a", "b", "-i", "("}, "missing closing"},
		{[]string{"-", "-"}, "only be used once"},
		{[]string{"nope-1.log", "nope-2.log"}, "no such file"},
		{[]string{"templates"}, "need at least one log"},
		{[]string{"a", "b", "--color", "sometimes"}, "auto, always or never"},
	}
	for _, c := range cases {
		code, _, errs := run(t, c.args...)
		if code != ExitError || !strings.Contains(errs, c.msg) {
			t.Errorf("%v: exit %d, stderr %q, want %q", c.args, code, errs, c.msg)
		}
	}
}

func TestHelpAndVersion(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"help"}, {"-h"}} {
		code, out, _ := run(t, args...)
		if code != ExitClean || !strings.Contains(out, "Usage:") {
			t.Errorf("%v: exit %d", args, code)
		}
	}
	code, out, _ := run(t, "version")
	if code != ExitClean || !strings.HasPrefix(out, "logdrift ") {
		t.Errorf("version: %d %q", code, out)
	}
}

func TestParseFlagForms(t *testing.T) {
	cfg, err := parse([]string{"-n5", "--top=7", "a", "-C", "0", "--min-stall", "250ms", "--", "-weird-name.log"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.top != 7 || cfg.context != -1 || cfg.minStall != 0.25 {
		t.Fatalf("cfg = %+v", cfg)
	}
	if len(cfg.files) != 2 || cfg.files[1] != "-weird-name.log" {
		t.Fatalf("files = %q", cfg.files)
	}
}

func TestCIDemo(t *testing.T) {
	code, out, _ := run(t, examples+"ci-pass-1.log", examples+"ci-pass-2.log", examples+"ci-fail.log", "-f", "json")
	if code != ExitDrift {
		t.Fatalf("exit %d", code)
	}
	var r struct {
		Summary struct {
			FirstDivergence struct{ Line int } `json:"first_divergence"`
		} `json:"summary"`
		Vanished []struct{ Template string } `json:"vanished"`
		Novel    []struct{ Template string } `json:"novel"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		t.Fatal(err)
	}
	if r.Summary.FirstDivergence.Line != 2 {
		t.Errorf("first divergence = %d, want 2 (the Node.js upgrade)", r.Summary.FirstDivergence.Line)
	}
	if len(r.Vanished) == 0 || r.Vanished[0].Template != "PASS src/payments/refund.test.ts (<NUM> s)" {
		t.Errorf("vanished = %+v", r.Vanished)
	}
	// ANSI color codes never reach templates
	if strings.Contains(out, `\u001b`) {
		t.Error("escape sequences leaked into the report")
	}
}
