// Package report renders an analyze.Report as terminal text, Markdown,
// a self-contained HTML page, or JSON.
package report

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
)

// Options shared by all renderers.
type Options struct {
	Top     int    // max items per section (0 = default 10)
	Width   int    // text width for terminal output (0 = 100)
	Color   bool   // ANSI colors for terminal output
	Version string // tool version, shown in footers
}

func (o *Options) normalize() {
	if o.Top <= 0 {
		o.Top = 10
	}
	if o.Width <= 0 {
		o.Width = 100
	}
	if o.Width < 50 {
		o.Width = 50
	}
}

// JSON writes the report as indented JSON.
func JSON(w io.Writer, r *analyze.Report, opts Options) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	type out struct {
		Tool    string `json:"tool"`
		Version string `json:"version,omitempty"`
		*analyze.Report
	}
	return enc.Encode(out{Tool: "logdrift", Version: opts.Version, Report: r})
}

// TopNovel selects at most n novel templates, preferring error-like ones,
// and returns them in order of first appearance.
func TopNovel(all []analyze.NovelTemplate, n int) []analyze.NovelTemplate {
	if len(all) <= n {
		return all
	}
	idx := make([]int, 0, n)
	for i, t := range all {
		if t.Error && len(idx) < n {
			idx = append(idx, i)
		}
	}
	for i, t := range all {
		if !t.Error && len(idx) < n {
			idx = append(idx, i)
		}
	}
	sort.Ints(idx)
	out := make([]analyze.NovelTemplate, len(idx))
	for k, i := range idx {
		out[k] = all[i]
	}
	return out
}

// Quantity formats v (in the base unit of dim) for humans.
func Quantity(v float64, dim string) string {
	if math.IsNaN(v) {
		return "n/a"
	}
	switch dim {
	case "time":
		return Duration(v)
	case "bytes":
		return bytesStr(v)
	case "percent":
		return trimFloat(v) + "%"
	}
	return trimFloat(v)
}

// Duration formats seconds compactly: 850µs, 23ms, 4.8s, 2m05s, 1h03m.
func Duration(s float64) string {
	a := math.Abs(s)
	switch {
	case a == 0:
		return "0s"
	case a < 1e-3:
		return trimFloat(s*1e6) + "µs"
	case a < 1:
		return trimFloat(s*1e3) + "ms"
	case a < 60:
		return trimFloat(s) + "s"
	case a < 3600:
		m := int(a / 60)
		return fmt.Sprintf("%dm%02ds", m, int(a)-m*60)
	default:
		h := int(a / 3600)
		return fmt.Sprintf("%dh%02dm", h, (int(a)-h*3600)/60)
	}
}

func bytesStr(v float64) string {
	units := []string{"B", "KiB", "MiB", "GiB", "TiB"}
	i := 0
	for math.Abs(v) >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	return trimFloat(v) + units[i]
}

func trimFloat(v float64) string {
	a := math.Abs(v)
	var s string
	switch {
	case a >= 100 || a == math.Trunc(a):
		s = fmt.Sprintf("%.0f", v)
	case a >= 10:
		s = fmt.Sprintf("%.1f", v)
	default:
		s = fmt.Sprintf("%.2f", v)
	}
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// Factor formats a ratio such as 41.2 as "×41" and 0.05 as "÷20".
func Factor(f float64) string {
	switch {
	case math.IsInf(f, 1):
		return "×∞"
	case f <= 0 || math.IsNaN(f):
		return "÷∞"
	case f >= 1:
		return "×" + trimFloat(f)
	default:
		return "÷" + trimFloat(1/f)
	}
}

// Range formats a baseline count envelope: "3" or "2–4".
func Range(lo, hi int) string {
	if lo == hi {
		return Thousands(lo)
	}
	return Thousands(lo) + "–" + Thousands(hi)
}

// Truncate shortens s to at most n runes, ending with an ellipsis.
func Truncate(s string, n int) string {
	if n <= 1 || utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

// Plural returns "1 thing" / "2 things".
func Plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// Thousands formats an integer with thin separators: 12,345.
func Thousands(n int) string {
	s := fmt.Sprint(n)
	if n < 0 {
		return "-" + Thousands(-n)
	}
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// ValueList renders "200 ×512, 201 ×3".
func ValueList(vs []analyze.ValueCount, limit int) string {
	parts := make([]string, 0, len(vs))
	for i, v := range vs {
		if i == limit {
			parts = append(parts, fmt.Sprintf("+%d more", len(vs)-limit))
			break
		}
		parts = append(parts, fmt.Sprintf("%s ×%d", Truncate(v.Value, 40), v.Count))
	}
	return strings.Join(parts, ", ")
}

// MarkCode returns a one-letter code for the strongest mark on a line.
func MarkCode(m uint8) string {
	switch {
	case m&analyze.MarkNovel != 0:
		return "N"
	case m&analyze.MarkStall != 0:
		return "S"
	case m&analyze.MarkParam != 0:
		return "P"
	case m&analyze.MarkShift != 0:
		return "F"
	case m&analyze.MarkTransition != 0:
		return "T"
	}
	return " "
}

// VerdictLine summarizes counts: "3 novel · 2 vanished · ...".
func VerdictLine(s analyze.Summary) string {
	var parts []string
	add := func(n int, label string) {
		if n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n, label))
		}
	}
	add(s.Novel, "novel")
	add(s.Vanished, "vanished")
	add(s.Shifted, "shifted")
	add(s.ParamDrift, "param drift")
	add(s.Stalls, plural(s.Stalls, "stall"))
	if len(parts) == 0 {
		return "no behavioral drift"
	}
	return strings.Join(parts, " · ")
}

func plural(n int, w string) string {
	if n == 1 {
		return w
	}
	return w + "s"
}

// SlotChange describes a parameter drift in one line of prose.
func SlotChange(p analyze.ParamDrift) string {
	if p.Kind == "categorical" {
		return fmt.Sprintf("baseline {%s} → new %s", ValueList(p.BaseValues, 4), ValueList(p.NewValues, 4))
	}
	return fmt.Sprintf("baseline p50 %s · p95 %s → target p50 %s · p95 %s (%s)",
		Quantity(p.BaseP50, p.Dimension), Quantity(p.BaseP95, p.Dimension),
		Quantity(p.TargetP50, p.Dimension), Quantity(p.TargetP95, p.Dimension), Factor(p.Factor))
}

func baselineNames(r *analyze.Report) string {
	names := make([]string, len(r.Baselines))
	for i, b := range r.Baselines {
		names[i] = b.Name
	}
	if len(names) > 3 {
		return strings.Join(names[:3], ", ") + fmt.Sprintf(", +%d more", len(names)-3)
	}
	return strings.Join(names, ", ")
}

func baselineLines(r *analyze.Report) int {
	n := 0
	for _, b := range r.Baselines {
		n += b.Lines
	}
	return n
}
