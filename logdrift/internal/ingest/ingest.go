// Package ingest reads log streams line by line and normalizes them: it
// transparently decompresses gzip, strips ANSI escape sequences and carriage
// return progress-bar redraws, and peels a leading timestamp off each line so
// it can be used for timing analysis.
package ingest

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// MaxLineBytes caps how much of a single line is kept. Longer lines are
// truncated (their tail is discarded) rather than failing the whole run.
const MaxLineBytes = 64 << 10

// Record is one normalized log line.
type Record struct {
	LineNo int       // 1-based physical line number in the source
	Raw    string    // cleaned line, including any timestamp prefix
	Body   string    // Raw with the leading timestamp removed
	TS     time.Time // parsed leading timestamp, if HasTS
	HasTS  bool
}

// Open opens path for reading; "-" means standard input. Gzip input is
// detected by its magic bytes, not by file extension.
func Open(path string) (io.ReadCloser, error) {
	var f io.ReadCloser
	if path == "-" {
		f = io.NopCloser(os.Stdin)
	} else {
		fh, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		f = fh
	}
	br := bufio.NewReaderSize(f, 256<<10)
	magic, _ := br.Peek(2)
	if len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			f.Close()
			return nil, err
		}
		return &stackCloser{Reader: gz, closers: []io.Closer{gz, f}}, nil
	}
	return &stackCloser{Reader: br, closers: []io.Closer{f}}, nil
}

type stackCloser struct {
	io.Reader
	closers []io.Closer
}

func (s *stackCloser) Close() error {
	var first error
	for _, c := range s.closers {
		if err := c.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// Options control which lines are emitted.
type Options struct {
	Ignore []*regexp.Regexp // lines whose Raw matches any of these are dropped
}

// Scan reads r and calls fn for every non-blank line.
func Scan(r io.Reader, opts Options, fn func(Record) error) error {
	br, ok := r.(*bufio.Reader)
	if !ok {
		br = bufio.NewReaderSize(r, 256<<10)
	}
	var buf []byte
	lineNo := 0
	for {
		buf = buf[:0]
		truncated := false
		var err error
		for {
			var chunk []byte
			chunk, err = br.ReadSlice('\n')
			if !truncated {
				room := MaxLineBytes - len(buf)
				if len(chunk) > room {
					chunk = chunk[:room]
					truncated = true
				}
				buf = append(buf, chunk...)
			}
			if err != bufio.ErrBufferFull {
				break
			}
		}
		if len(buf) == 0 && err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		lineNo++
		line := Clean(buf)
		if strings.TrimSpace(line) != "" && !ignored(line, opts.Ignore) {
			rec := Record{LineNo: lineNo, Raw: line}
			rec.Body, rec.TS, rec.HasTS = SplitTimestamp(line)
			if strings.TrimSpace(rec.Body) != "" {
				if ferr := fn(rec); ferr != nil {
					return ferr
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func ignored(line string, res []*regexp.Regexp) bool {
	for _, re := range res {
		if re.MatchString(line) {
			return true
		}
	}
	return false
}

// Clean strips the line terminator, ANSI escape sequences, carriage-return
// redraws (keeping the final visible state) and other control characters.
func Clean(b []byte) string {
	b = bytes.TrimRight(b, "\r\n")
	if i := bytes.LastIndexByte(b, '\r'); i >= 0 {
		// Progress bars redraw with \r: what remains visible is the last segment.
		b = b[i+1:]
	}
	if bytes.IndexByte(b, 0x1b) < 0 && !hasControl(b) {
		return string(b)
	}
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); i++ {
		c := b[i]
		if c == 0x1b {
			i = skipEscape(b, i)
			continue
		}
		if c == '\t' {
			out = append(out, ' ')
			continue
		}
		if c < 0x20 || c == 0x7f {
			continue
		}
		out = append(out, c)
	}
	return string(out)
}

func hasControl(b []byte) bool {
	for _, c := range b {
		if c < 0x20 || c == 0x7f {
			return true
		}
	}
	return false
}

// skipEscape returns the index of the last byte of the escape sequence that
// starts at b[i] (which is ESC).
func skipEscape(b []byte, i int) int {
	if i+1 >= len(b) {
		return i
	}
	switch b[i+1] {
	case '[': // CSI: parameters, intermediates, final byte 0x40-0x7e
		j := i + 2
		for j < len(b) && b[j] >= 0x20 && b[j] <= 0x3f {
			j++
		}
		for j < len(b) && b[j] >= 0x20 && b[j] <= 0x2f {
			j++
		}
		if j < len(b) {
			return j
		}
		return len(b) - 1
	case ']': // OSC: terminated by BEL or ESC \
		for j := i + 2; j < len(b); j++ {
			if b[j] == 0x07 {
				return j
			}
			if b[j] == 0x1b && j+1 < len(b) && b[j+1] == '\\' {
				return j + 1
			}
		}
		return len(b) - 1
	default:
		return i + 1
	}
}

var (
	isoRe    = regexp.MustCompile(`^\[?(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?\]?(?:\s+|$)`)
	syslogRe = regexp.MustCompile(`^\[?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\]?(?:\s+|$)`)
	clockRe  = regexp.MustCompile(`^\[?(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\]?(?:\s+|$)`)
	epochRe  = regexp.MustCompile(`^\[?(\d{10})(?:\.(\d{1,9}))?\]?\s+|^\[?(\d{13})\]?\s+`)
)

var months = map[string]time.Month{
	"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
	"Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}

// SplitTimestamp removes a recognized leading timestamp from line and returns
// the remaining body together with the parsed time. Lines without a
// recognized timestamp are returned unchanged with ok == false.
func SplitTimestamp(line string) (body string, ts time.Time, ok bool) {
	if line == "" || !(isDigitByte(line[0]) || line[0] == '[' || isUpper(line[0])) {
		return line, time.Time{}, false
	}
	if m := isoRe.FindStringSubmatchIndex(line); m != nil {
		g := groups(line, m)
		t := time.Date(atoi(g[1]), time.Month(atoi(g[2])), atoi(g[3]), atoi(g[4]), atoi(g[5]), atoi(g[6]), nanos(g[7]), zone(g[8]))
		return line[m[1]:], t, true
	}
	if m := syslogRe.FindStringSubmatchIndex(line); m != nil {
		g := groups(line, m)
		t := time.Date(2000, months[g[1]], atoi(g[2]), atoi(g[3]), atoi(g[4]), atoi(g[5]), nanos(g[6]), time.UTC)
		return line[m[1]:], t, true
	}
	if m := clockRe.FindStringSubmatchIndex(line); m != nil {
		g := groups(line, m)
		t := time.Date(2000, 1, 1, atoi(g[1]), atoi(g[2]), atoi(g[3]), nanos(g[4]), time.UTC)
		return line[m[1]:], t, true
	}
	if m := epochRe.FindStringSubmatchIndex(line); m != nil {
		g := groups(line, m)
		var t time.Time
		if g[3] != "" {
			ms, _ := strconv.ParseInt(g[3], 10, 64)
			t = time.UnixMilli(ms).UTC()
		} else {
			sec, _ := strconv.ParseInt(g[1], 10, 64)
			t = time.Unix(sec, int64(nanos(g[2]))).UTC()
		}
		return line[m[1]:], t, true
	}
	return line, time.Time{}, false
}

func groups(s string, m []int) []string {
	out := make([]string, len(m)/2)
	for i := range out {
		if m[2*i] >= 0 {
			out[i] = s[m[2*i]:m[2*i+1]]
		}
	}
	return out
}

func atoi(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		n = n*10 + int(s[i]-'0')
	}
	return n
}

func nanos(frac string) int {
	if frac == "" {
		return 0
	}
	for len(frac) < 9 {
		frac += "0"
	}
	return atoi(frac[:9])
}

func zone(z string) *time.Location {
	if z == "" || z == "Z" {
		return time.UTC
	}
	sign := 1
	if z[0] == '-' {
		sign = -1
	}
	z = strings.ReplaceAll(z[1:], ":", "")
	if len(z) != 4 {
		return time.UTC
	}
	off := sign * (atoi(z[:2])*3600 + atoi(z[2:])*60)
	return time.FixedZone("", off)
}

func isDigitByte(c byte) bool { return c >= '0' && c <= '9' }
func isUpper(c byte) bool     { return c >= 'A' && c <= 'Z' }
