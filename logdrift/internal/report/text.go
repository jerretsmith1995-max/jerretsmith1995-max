package report

import (
	"bufio"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
)

type palette struct {
	on bool
}

const (
	reset   = "\x1b[0m"
	bold    = "\x1b[1m"
	dim     = "\x1b[2m"
	red     = "\x1b[31m"
	green   = "\x1b[32m"
	yellow  = "\x1b[33m"
	blue    = "\x1b[34m"
	magenta = "\x1b[35m"
	cyan    = "\x1b[36m"
	badRev  = "\x1b[1;97;41m"
	okRev   = "\x1b[1;30;42m"
)

func (p palette) c(code, s string) string {
	if !p.on || s == "" {
		return s
	}
	return code + s + reset
}

var placeholderRe = regexp.MustCompile(`<(\*|TS|UUID|IP|HEX|DUR|SIZE|NUM|ID)>`)

// tmpl highlights placeholders inside a template.
func (p palette) tmpl(s string) string {
	if !p.on {
		return s
	}
	return placeholderRe.ReplaceAllString(s, cyan+"$0"+reset)
}

// Text writes a human-oriented terminal report.
func Text(w io.Writer, r *analyze.Report, opts Options) error {
	opts.normalize()
	bw := bufio.NewWriter(w)
	t := &textWriter{w: bw, p: palette{opts.Color}, width: opts.Width, top: opts.Top}
	t.render(r)
	return bw.Flush()
}

type textWriter struct {
	w     *bufio.Writer
	p     palette
	width int
	top   int
}

func (t *textWriter) line(format string, args ...any) {
	fmt.Fprintf(t.w, format+"\n", args...)
}

// fit truncates plain text so a row of prefix+text fits the terminal width.
func (t *textWriter) fit(text string, used int) string {
	return Truncate(text, t.width-used)
}

func (t *textWriter) render(r *analyze.Report) {
	p := t.p
	s := r.Summary
	t.line("%s  baseline %s %s   target %s %s",
		p.c(bold, "logdrift"),
		p.c(bold, baselineNames(r)),
		p.c(dim, fmt.Sprintf("(%s · %s lines)", Plural(len(r.Baselines), "run"), Thousands(baselineLines(r)))),
		p.c(bold, r.Target.Name),
		p.c(dim, fmt.Sprintf("(%s lines · %s templates)", Thousands(r.Target.Lines), Thousands(r.Templates))))
	t.line("")
	if s.Drift {
		t.line(" %s  %s", p.c(badRev, " DRIFT "), p.c(bold, VerdictLine(s)))
	} else {
		t.line(" %s  %s", p.c(okRev, " CLEAN "), p.c(bold, "target behaves like baseline"))
	}
	if d := s.FirstDivergence; d != nil {
		t.line("          %s %s  %s", p.c(dim, "first divergence"), p.c(bold, fmt.Sprintf("%s:%d", r.Target.Name, d.Line)), p.c(dim, d.Reason))
	}
	if pr := r.Progress; pr != nil && pr.Expected > 0 {
		msg := fmt.Sprintf("reached %d/%d baseline milestones", pr.Reached, pr.Expected)
		t.line("          %s %s", p.c(dim, "progress        "), msg)
		if pr.FirstMissed != "" {
			if pr.LastReached != "" {
				t.line("          %s %s %s", p.c(dim, "  got as far as "), p.c(dim, fmt.Sprintf("L%d", pr.LastReachedLine)), p.tmpl(t.fit(pr.LastReached, 36)))
			}
			t.line("          %s %s", p.c(dim, "  never reached "), p.tmpl(t.fit(pr.FirstMissed, 32)))
		}
	}
	if s.NovelTransitions > 0 {
		t.line("          %s %d adjacent template pairs never seen in baseline %s", p.c(dim, "sequence        "), s.NovelTransitions, p.c(dim, "(weak signal)"))
	}

	t.novel(r)
	t.vanished(r)
	t.shifted(r)
	t.params(r)
	t.stalls(r)
	t.context(r)
	t.line("")
}

func (t *textWriter) section(color, title, sub string, n, shown int) {
	t.line("")
	more := ""
	if n > shown {
		more = t.p.c(dim, fmt.Sprintf("  (top %d of %d)", shown, n))
	}
	t.line("%s %s %s%s", t.p.c(color, "▌"), t.p.c(bold+color, title), t.p.c(dim, sub), more)
}

func (t *textWriter) novel(r *analyze.Report) {
	if len(r.Novel) == 0 {
		return
	}
	items := TopNovel(r.Novel, t.top)
	t.section(red, "NOVEL", "templates the baseline never produced", len(r.Novel), len(items))
	lw, cw := 0, 0
	for _, n := range items {
		lw = max(lw, len(fmt.Sprintf("L%d", n.FirstLine)))
		cw = max(cw, len("×"+Thousands(n.Count)))
	}
	for _, n := range items {
		mark := "  "
		if n.Error {
			mark = t.p.c(red, "✖ ")
		}
		prefix := fmt.Sprintf("  %-*s %*s  ", lw, fmt.Sprintf("L%d", n.FirstLine), cw+1, "×"+Thousands(n.Count))
		t.line("%s%s%s", t.p.c(dim, prefix), mark, t.p.tmpl(t.fit(n.Template, len(prefix)+2)))
	}
}

func (t *textWriter) vanished(r *analyze.Report) {
	if len(r.Vanished) == 0 {
		return
	}
	n := min(t.top, len(r.Vanished))
	t.section(magenta, "VANISHED", "every baseline run produced these; the target never did", len(r.Vanished), n)
	cw := 0
	for _, v := range r.Vanished[:n] {
		lo, hi := minMax(v.BaseCounts)
		cw = max(cw, len("×"+Range(lo, hi)))
	}
	for _, v := range r.Vanished[:n] {
		lo, hi := minMax(v.BaseCounts)
		prefix := fmt.Sprintf("  %-5s %*s  ", fmt.Sprintf("@%d%%", int(v.Position*100+0.5)), cw+1, "×"+Range(lo, hi))
		t.line("%s%s", t.p.c(dim, prefix), t.p.tmpl(t.fit(v.Template, len(prefix))))
	}
}

func (t *textWriter) shifted(r *analyze.Report) {
	if len(r.Shifted) == 0 {
		return
	}
	n := min(t.top, len(r.Shifted))
	t.section(yellow, "SHIFTED", "frequency outside the baseline envelope", len(r.Shifted), n)
	cw := 0
	for _, s := range r.Shifted[:n] {
		cw = max(cw, len([]rune("×"+Thousands(s.Target)+" vs "+Range(s.BaseMin, s.BaseMax))))
	}
	for _, s := range r.Shifted[:n] {
		arrow := t.p.c(yellow, "▲")
		if s.Direction == "down" {
			arrow = t.p.c(blue, "▼")
		}
		counts := "×" + Thousands(s.Target) + " vs " + Range(s.BaseMin, s.BaseMax)
		prefix := fmt.Sprintf("  %s %s%s  ", arrow, counts, strings.Repeat(" ", cw-len([]rune(counts))))
		used := 6 + cw
		t.line("%s%s", prefix, t.p.tmpl(t.fit(s.Template, used)))
	}
}

func (t *textWriter) params(r *analyze.Report) {
	if len(r.ParamDrift) == 0 {
		return
	}
	n := min(t.top, len(r.ParamDrift))
	t.section(cyan, "PARAMETER DRIFT", "same message, different values", len(r.ParamDrift), n)
	for _, pd := range r.ParamDrift[:n] {
		head := fmt.Sprintf("  %-7s ", fmt.Sprintf("L%d", pd.FirstLine))
		t.line("%s%s", t.p.c(dim, head), t.p.tmpl(t.fit(pd.Template, len(head))))
		slot := fmt.Sprintf("%s:", pd.Slot)
		t.line("          %s %s", t.p.c(bold, slot), t.fit(SlotChange(pd), 11+len(slot)))
	}
}

func (t *textWriter) stalls(r *analyze.Report) {
	if len(r.Stalls) == 0 {
		return
	}
	n := min(t.top, len(r.Stalls))
	t.section(yellow, "STALLS", "silences far longer than any baseline gap at that point", len(r.Stalls), n)
	for _, s := range r.Stalls[:n] {
		prefix := fmt.Sprintf("  %-7s +%-7s ", fmt.Sprintf("L%d", s.Line), Duration(s.Gap))
		ref := fmt.Sprintf(" (baseline ≤%s)", Duration(s.Reference))
		t.line("%s%s%s", t.p.c(dim, prefix), t.p.tmpl(t.fit(s.Template, len(prefix)+len(ref))), t.p.c(dim, ref))
	}
}

func (t *textWriter) context(r *analyze.Report) {
	if len(r.Context) == 0 {
		return
	}
	t.section(dim, "AT THE DIVERGENCE", r.Target.Name, 0, 0)
	w := len(fmt.Sprint(r.Context[len(r.Context)-1].Line))
	for _, c := range r.Context {
		code := MarkCode(c.Marks)
		gutter := "  "
		num := fmt.Sprintf("%*d", w, c.Line)
		text := t.fit(c.Text, w+8)
		switch {
		case c.Focus:
			gutter = t.p.c(red+bold, "▶ ")
			num = t.p.c(bold, num)
			text = t.p.c(bold, text)
		case code == " ":
			text = t.p.c(dim, text)
		}
		t.line("%s%s %s %s %s", gutter, num, t.p.c(dim, "│"), markColor(t.p, code), text)
	}
	t.line("  %s", t.p.c(dim, strings.Repeat(" ", w)+"   N novel · P param drift · S stall · F frequency · T new sequence"))
}

func markColor(p palette, code string) string {
	switch code {
	case "N":
		return p.c(red+bold, code)
	case "P":
		return p.c(cyan+bold, code)
	case "S":
		return p.c(yellow+bold, code)
	case "F":
		return p.c(yellow, code)
	case "T":
		return p.c(dim, code)
	}
	return code
}

func minMax(xs []int) (int, int) {
	if len(xs) == 0 {
		return 0, 0
	}
	lo, hi := xs[0], xs[0]
	for _, x := range xs[1:] {
		lo, hi = min(lo, x), max(hi, x)
	}
	return lo, hi
}
