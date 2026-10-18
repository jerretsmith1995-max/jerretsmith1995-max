package ingest

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestClean(t *testing.T) {
	cases := map[string]string{
		"plain\n":                           "plain",
		"crlf\r\n":                          "crlf",
		"\x1b[31mred\x1b[0m text":           "red text",
		"\x1b[1;38;5;196mbold\x1b[m":        "bold",
		"downloading 10%\rdownloading 100%": "downloading 100%",
		"\x1b]0;window title\x07after":      "after",
		"tab\tseparated":                    "tab separated",
		"bell\x07 and null\x00":             "bell and null",
		"dangling escape \x1b":              "dangling escape ",
	}
	for in, want := range cases {
		if got := Clean([]byte(in)); got != want {
			t.Errorf("Clean(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitTimestamp(t *testing.T) {
	utc := time.UTC
	cases := []struct {
		in, body string
		ts       time.Time
		ok       bool
	}{
		{"2026-10-17T09:00:00.123Z INFO hi", "INFO hi", time.Date(2026, 10, 17, 9, 0, 0, 123e6, utc), true},
		{"2026-10-17 09:00:00,5 WARN x", "WARN x", time.Date(2026, 10, 17, 9, 0, 0, 5e8, utc), true},
		{"[2026-10-17T09:00:00+02:00] boot", "boot", time.Date(2026, 10, 17, 7, 0, 0, 0, utc), true},
		{"2026-10-17T09:00:00.1234567Z ##[group]Run tests", "##[group]Run tests", time.Date(2026, 10, 17, 9, 0, 0, 123456700, utc), true},
		{"Oct  7 14:02:11 host sshd[12]: ok", "host sshd[12]: ok", time.Date(2000, 10, 7, 14, 2, 11, 0, utc), true},
		{"14:02:11.250 ready", "ready", time.Date(2000, 1, 1, 14, 2, 11, 25e7, utc), true},
		{"1760691600.5 tick", "tick", time.Unix(1760691600, 5e8), true},
		{"1760691600500 tick", "tick", time.UnixMilli(1760691600500), true},
		{"INFO no timestamp", "INFO no timestamp", time.Time{}, false},
		{"12345 not a time", "12345 not a time", time.Time{}, false},
		{"", "", time.Time{}, false},
	}
	for _, c := range cases {
		body, ts, ok := SplitTimestamp(c.in)
		if body != c.body || ok != c.ok || (ok && !ts.Equal(c.ts)) {
			t.Errorf("SplitTimestamp(%q) = %q %v %v, want %q %v %v", c.in, body, ts, ok, c.body, c.ts, c.ok)
		}
	}
}

func collect(t *testing.T, input string, opts Options) []Record {
	t.Helper()
	var out []Record
	if err := Scan(strings.NewReader(input), opts, func(r Record) error { out = append(out, r); return nil }); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestScan(t *testing.T) {
	in := "first\n\n   \nsecond\r\nthird without newline"
	recs := collect(t, in, Options{})
	if len(recs) != 3 {
		t.Fatalf("got %d records: %+v", len(recs), recs)
	}
	if recs[0].LineNo != 1 || recs[1].LineNo != 4 || recs[2].LineNo != 5 {
		t.Errorf("line numbers = %d %d %d", recs[0].LineNo, recs[1].LineNo, recs[2].LineNo)
	}
	if recs[2].Raw != "third without newline" {
		t.Errorf("last = %q", recs[2].Raw)
	}
}

func TestScanIgnore(t *testing.T) {
	recs := collect(t, "keep\nDEBUG drop\nkeep too\n", Options{Ignore: []*regexp.Regexp{regexp.MustCompile(`^DEBUG`)}})
	if len(recs) != 2 || recs[1].Raw != "keep too" {
		t.Fatalf("got %+v", recs)
	}
}

func TestScanLongLine(t *testing.T) {
	long := strings.Repeat("x", 3*MaxLineBytes)
	recs := collect(t, "a\n"+long+"\nb\n", Options{})
	if len(recs) != 3 {
		t.Fatalf("got %d records", len(recs))
	}
	if len(recs[1].Raw) != MaxLineBytes {
		t.Errorf("long line kept %d bytes, want %d", len(recs[1].Raw), MaxLineBytes)
	}
	if recs[2].Raw != "b" || recs[2].LineNo != 3 {
		t.Errorf("line after long line = %+v", recs[2])
	}
}

func TestScanTimestampOnlyLineSkipped(t *testing.T) {
	recs := collect(t, "2026-10-17T09:00:00Z\n2026-10-17T09:00:01Z hello\n", Options{})
	if len(recs) != 1 || recs[0].Body != "hello" {
		t.Fatalf("got %+v", recs)
	}
}

func TestOpenGzip(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write([]byte("compressed line\n"))
	zw.Close()
	path := filepath.Join(dir, "log.txt") // no .gz extension: detection is by content
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	rc, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	var got []string
	Scan(rc, Options{}, func(r Record) error { got = append(got, r.Raw); return nil })
	if len(got) != 1 || got[0] != "compressed line" {
		t.Fatalf("got %q", got)
	}
}

func TestOpenMissing(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "nope.log")); err == nil {
		t.Fatal("expected error")
	}
}
