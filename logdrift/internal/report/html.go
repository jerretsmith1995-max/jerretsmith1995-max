package report

import (
	_ "embed"
	"encoding/json"
	"html"
	"html/template"
	"io"
	"regexp"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
)

//go:embed report.html.tmpl
var htmlSource string

var htmlTmpl = template.Must(template.New("report").Funcs(template.FuncMap{
	"tmpl":       highlightHTML,
	"dur":        Duration,
	"factor":     Factor,
	"rng":        Range,
	"thousands":  Thousands,
	"plural":     Plural,
	"slotChange": SlotChange,
	"markCode":   MarkCode,
	"markClass":  markClass,
	"pct":        func(f float64) int { return int(f*100 + 0.5) },
	"minmax":     func(xs []int) string { lo, hi := minMax(xs); return Range(lo, hi) },
	"verdict":    VerdictLine,
	"names":      baselineNames,
	"baseLines":  baselineLines,
	"qty":        Quantity,
	"values":     ValueList,
	"add":        func(a, b int) int { return a + b },
}).Parse(htmlSource))

var escapedPlaceholderRe = regexp.MustCompile(`&lt;(\*|TS|UUID|IP|HEX|DUR|SIZE|NUM|ID)&gt;`)

// highlightHTML escapes a template and wraps its placeholders in spans.
func highlightHTML(s string) template.HTML {
	esc := html.EscapeString(s)
	return template.HTML(escapedPlaceholderRe.ReplaceAllString(esc, `<span class="ph">&lt;$1&gt;</span>`))
}

func markClass(m uint8) string {
	switch MarkCode(m) {
	case "N":
		return "novel"
	case "S":
		return "stall"
	case "P":
		return "param"
	case "F":
		return "shift"
	case "T":
		return "seq"
	}
	return ""
}

const timelineBuckets = 400

type cell struct {
	X       int
	Opacity float64
	First   int // physical line range covered
	End     int
}

type lane struct {
	Class, Label string
	Count        int
	Cells        []cell
}

type htmlData struct {
	R        *analyze.Report
	Opts     Options
	Novel    []analyze.NovelTemplate
	Vanished []analyze.VanishedTemplate
	Shifted  []analyze.Shift
	Params   []analyze.ParamDrift
	Stalls   []analyze.Stall
	Lanes    []lane
	NB       int
	FocusPct float64
	HasFocus bool
	Payload  template.JS
	MarkedN  int
}

// HTML writes a self-contained, interactive HTML report.
func HTML(w io.Writer, r *analyze.Report, opts Options) error {
	opts.normalize()
	top := func(n int) int { return min(n, opts.Top) }
	d := htmlData{
		R:        r,
		Opts:     opts,
		Novel:    TopNovel(r.Novel, opts.Top),
		Vanished: r.Vanished[:top(len(r.Vanished))],
		Shifted:  r.Shifted[:top(len(r.Shifted))],
		Params:   r.ParamDrift[:top(len(r.ParamDrift))],
		Stalls:   r.Stalls[:top(len(r.Stalls))],
		MarkedN:  len(r.Marked),
	}
	d.Lanes, d.NB = buildLanes(r)
	if fd := r.Summary.FirstDivergence; fd != nil && d.NB > 0 {
		for i, no := range r.LineNos {
			if no == fd.Line {
				d.FocusPct = 100 * (float64(i) + 0.5) / float64(len(r.LineNos))
				d.HasFocus = true
				break
			}
		}
	}

	type jsLine struct {
		L int    `json:"l"`
		M uint8  `json:"m"`
		T string `json:"t"`
	}
	lines := make([]jsLine, len(r.Marked))
	for i, c := range r.Marked {
		lines[i] = jsLine{c.Line, c.Marks, c.Text}
	}
	payload, err := json.Marshal(struct {
		Lines []jsLine `json:"lines"`
	}{lines})
	if err != nil {
		return err
	}
	// json.Marshal escapes <, > and & so the payload cannot close the script element.
	d.Payload = template.JS(payload)
	return htmlTmpl.Execute(w, d)
}

// buildLanes renders one row per finding kind. Each cell covers a slice of
// the target run; its opacity encodes how many lines in the slice carry the mark.
func buildLanes(r *analyze.Report) ([]lane, int) {
	n := len(r.LineMarks)
	if n == 0 {
		return nil, 0
	}
	nb := min(n, timelineBuckets)
	kinds := []struct {
		bit          uint8
		class, label string
	}{
		{analyze.MarkNovel, "novel", "novel"},
		{analyze.MarkParam, "param", "param drift"},
		{analyze.MarkStall, "stall", "stall"},
		{analyze.MarkShift, "shift", "frequency"},
		{analyze.MarkTransition, "seq", "sequence"},
	}
	var lanes []lane
	for _, k := range kinds {
		ln := lane{Class: k.class, Label: k.label}
		for b := 0; b < nb; b++ {
			lo, hi := b*n/nb, (b+1)*n/nb
			hits := 0
			for i := lo; i < hi; i++ {
				if r.LineMarks[i]&k.bit != 0 {
					hits++
				}
			}
			if hits == 0 {
				continue
			}
			ln.Count += hits
			frac := float64(hits) / float64(hi-lo)
			ln.Cells = append(ln.Cells, cell{X: b, Opacity: 0.35 + 0.65*frac, First: r.LineNos[lo], End: r.LineNos[hi-1]})
		}
		if ln.Count > 0 {
			lanes = append(lanes, ln)
		}
	}
	return lanes, nb
}
