package report

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
)

// TemplatesText lists mined templates, most frequent first.
func TemplatesText(w io.Writer, ts []analyze.TemplateInfo, opts Options) error {
	opts.normalize()
	bw := bufio.NewWriter(w)
	p := palette{opts.Color}
	width := len(Thousands(maxCount(ts)))
	for _, t := range ts {
		count := fmt.Sprintf("%*s", width, Thousands(t.Count))
		fmt.Fprintf(bw, "%s  %s\n", p.c(dim, count), p.tmpl(Truncate(t.Template, opts.Width-width-2)))
	}
	return bw.Flush()
}

// TemplatesJSON writes templates as a JSON array.
func TemplatesJSON(w io.Writer, ts []analyze.TemplateInfo) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if ts == nil {
		ts = []analyze.TemplateInfo{}
	}
	return enc.Encode(ts)
}

func maxCount(ts []analyze.TemplateInfo) int {
	m := 0
	for _, t := range ts {
		m = max(m, t.Count)
	}
	return m
}
