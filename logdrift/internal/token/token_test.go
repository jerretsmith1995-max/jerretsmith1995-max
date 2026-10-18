package token

import (
	"math"
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := map[string]Kind{
		"hello":                                Literal,
		"deadbeef":                             Literal, // no digit: a word as far as we can tell
		"42":                                   NUM,
		"-3.5":                                 NUM,
		"1e-9":                                 NUM,
		"97.5%":                                NUM,
		"23ms":                                 DUR,
		"1.5s":                                 DUR,
		"2m30s":                                DUR,
		"1h2m3.5s":                             DUR,
		"850µs":                                DUR,
		"512MiB":                               SIZE,
		"3.2GB":                                SIZE,
		"10.0.4.12":                            IP,
		"10.0.4.12:5432":                       IP,
		"192.168.0.0/16":                       IP,
		"256.1.1.1":                            ID,
		"f47ac10b-58cc-4372-a567-0e02b2c3d479": UUID,
		"0x7ffe12":                             HEX,
		"8f3a2c1d":                             HEX,
		"2026-10-17":                           TS,
		"2026-10-17T09:00:00.123Z":             TS,
		"12:30:45":                             TS,
		"12:30:45,999":                         TS,
		"worker-12":                            ID,
		"v2.14.1":                              ID,
		"x509":                                 ID,
	}
	for in, want := range cases {
		if got := Classify(in); got != want {
			t.Errorf("Classify(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestTokenize(t *testing.T) {
	type tk struct{ text, value string }
	cases := []struct {
		in   string
		want []tk
	}{
		{"request status=200 latency=23ms", []tk{{"request", "request"}, {"status=<NUM>", "200"}, {"latency=<DUR>", "23ms"}}},
		{"took (12ms), done.", []tk{{"took", "took"}, {"(<DUR>),", "12ms"}, {"done.", "done"}}},
		{`user="alice" mode=fast`, []tk{{`user="alice"`, "alice"}, {"mode=fast", "fast"}}},
		{"[worker-3] ready", []tk{{"[worker-<NUM>]", "worker-3"}, {"ready", "ready"}}},
		{"x509: expired", []tk{{"x509:", "x509"}, {"expired", "expired"}}},
		{"at service.go:212 +0x3c", []tk{{"at", "at"}, {"service.go:<NUM>", "service.go:212"}, {"+<HEX>", "0x3c"}}},
		{"  spaced\tout  ", []tk{{"spaced", "spaced"}, {"out", "out"}}},
		{"path=/v1/charges", []tk{{"path=/v1/charges", "/v1/charges"}}},
		{"key=customer:8812", []tk{{"key=customer:<NUM>", "customer:8812"}}},
		{"=", []tk{{"=", "="}}},
	}
	for _, c := range cases {
		got := Tokenize(c.in, nil)
		if len(got) != len(c.want) {
			t.Errorf("Tokenize(%q) = %d tokens %+v, want %d", c.in, len(got), got, len(c.want))
			continue
		}
		for i, w := range c.want {
			if got[i].Text != w.text || got[i].Value != w.value {
				t.Errorf("Tokenize(%q)[%d] = {%q %q}, want {%q %q}", c.in, i, got[i].Text, got[i].Value, w.text, w.value)
			}
		}
	}
}

func TestMaskPartial(t *testing.T) {
	cases := map[string]string{
		"worker-12":              "worker-<NUM>",
		"sha256":                 "sha256",
		"http2":                  "http2",
		"I0115":                  "I<NUM>",
		"req_8f2a1c":             "req_<HEX>",
		"abz123xyz":              "abz<NUM>xyz",
		"Authorize(0x0":          "Authorize(<HEX>",
		"/var/log/app-3.log":     "/var/log/app-<NUM>.log",
		"日本-42":                  "日本-<NUM>",
		"github.com/a/b.(*S).F2": "github.com/a/b.(*S).F2",
	}
	for in, want := range cases {
		got, _ := MaskPartial(in)
		if got != want {
			t.Errorf("MaskPartial(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestQuantity(t *testing.T) {
	cases := []struct {
		in  string
		v   float64
		dim Dimension
		ok  bool
	}{
		{"42", 42, Plain, true},
		{"23ms", 0.023, Time, true},
		{"1m30s", 90, Time, true},
		{"2h", 7200, Time, true},
		{"1.5KiB", 1536, Bytes, true},
		{"50%", 50, Percent, true},
		{"-7", -7, Plain, true},
		{"3e2", 300, Plain, true},
		{"12abc", 0, Plain, false},
		{"abc", 0, Plain, false},
		{"", 0, Plain, false},
		{".", 0, Plain, false},
	}
	for _, c := range cases {
		v, dim, ok := Quantity(c.in)
		if ok != c.ok || (ok && (math.Abs(v-c.v) > 1e-9 || dim != c.dim)) {
			t.Errorf("Quantity(%q) = %v %v %v, want %v %v %v", c.in, v, dim, ok, c.v, c.dim, c.ok)
		}
	}
}

func TestKeyPrefix(t *testing.T) {
	cases := map[string]string{
		"a=b":         "a=",
		"user.id=7":   "user.id=",
		"=x":          "",
		"a=":          "",
		"9a=b":        "",
		"x==y":        "x=",
		"path=/a=b":   "path=",
		"not a key=1": "",
	}
	for in, want := range cases {
		if got := KeyPrefix(in); got != want {
			t.Errorf("KeyPrefix(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHasMask(t *testing.T) {
	for _, s := range []string{"<NUM>", "status=<NUM>", "<*>", "(<DUR>)"} {
		if !HasMask(s) {
			t.Errorf("HasMask(%q) = false", s)
		}
	}
	for _, s := range []string{"<html>", "a<b", "plain"} {
		if HasMask(s) {
			t.Errorf("HasMask(%q) = true", s)
		}
	}
}

// Same shape, different values: identical template text.
func TestTokenizeStableTemplate(t *testing.T) {
	a := Tokenize("INFO request id=f47ac10b-58cc-4372-a567-0e02b2c3d479 status=200 latency=23ms from 10.0.0.1", nil)
	b := Tokenize("INFO request id=0e02b2c3-a567-4372-58cc-f47ac10bd479 status=503 latency=4.8s from 10.9.8.7", nil)
	if text(a) != text(b) {
		t.Fatalf("templates differ:\n%s\n%s", text(a), text(b))
	}
}

func text(ts []Token) string {
	parts := make([]string, len(ts))
	for i, t := range ts {
		parts[i] = t.Text
	}
	return strings.Join(parts, " ")
}

func FuzzTokenize(f *testing.F) {
	for _, s := range []string{"a=b c=12ms", "[x-1] (0x1f),", "2026-01-01T00:00:00Z ok", "µs=5µs", "\xff\xfe=1"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		toks := Tokenize(s, nil)
		want := strings.FieldsFunc(s, func(r rune) bool { return r < 0x80 && isSpace(byte(r)) })
		if len(toks) != len(want) {
			t.Fatalf("token count mismatch for %q: %d vs %d", s, len(toks), len(want))
		}
		for _, tk := range toks {
			if tk.Text == "" {
				t.Fatalf("empty token text for %q", s)
			}
			if tk.Kind == Literal && strings.Contains(tk.Text, "<NUM>") {
				t.Fatalf("literal token carries a mask: %+v", tk)
			}
			Quantity(tk.Value)
		}
	})
}

func BenchmarkTokenize(b *testing.B) {
	line := "2026-10-17T09:00:00.123Z INFO request id=f47ac10b-58cc-4372-a567-0e02b2c3d479 method=POST path=/v1/charges status=200 latency=23ms"
	var buf []Token
	b.SetBytes(int64(len(line)))
	for i := 0; i < b.N; i++ {
		buf = Tokenize(line, buf[:0])
	}
}
