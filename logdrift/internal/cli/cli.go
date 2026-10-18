// Package cli implements the logdrift command line.
package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/analyze"
	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/drain"
	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/ingest"
	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/report"
)

// Version is overridden at build time with -ldflags "-X ...cli.Version=v1.2.3".
var Version = "v0.1.0"

// Exit codes, diff(1)-style.
const (
	ExitClean = 0
	ExitDrift = 1
	ExitError = 2
)

const usage = `logdrift — diff the behavior of logs, not their bytes.

Give it one or more logs from good runs and one log from a bad run. It mines
every line into templates, then tells you what the bad run did differently:
messages that are new, milestones that never happened, messages that fire far
more (or less) often, parameters whose values changed, unusual silences — and
the exact line where the run first went off the rails.

Usage:
  logdrift [diff] [flags] BASELINE... TARGET
  logdrift templates [flags] FILE...
  logdrift version

  The last file is the target; every file before it is a baseline. Use "-" to
  read the target from standard input. Gzip input is detected automatically.

Flags (diff):
  -f, --format FORMAT   text (default), json, md, html
  -o, --output FILE     write the report to FILE instead of standard output
  -n, --top N           items shown per section (default 10)
  -C, --context N       lines of context around the first divergence (default 4)
  -i, --ignore REGEX    drop lines matching REGEX before analysis (repeatable)
      --quorum F        fraction of baselines that must contain a template for
                        it to count as expected (default 1.0 = all of them)
      --min-stall DUR   shortest silence reported as a stall (default 1s)
  -s, --sim F           template similarity threshold 0..1 (default 0.5)
      --depth N         leading tokens used to route templates (default 2)
      --color WHEN      auto (default), always, never
      --exit-zero       exit 0 even when drift is found

Flags (templates):
  -f, --format FORMAT   text (default) or json
  -n, --top N           show the N most frequent templates (default all)
  -s, --sim F, --depth N, -i REGEX, --color WHEN   as above

Exit status: 0 no drift, 1 drift found, 2 error.

Examples:
  logdrift good.log bad.log
  logdrift ci-pass-*.log ci-fail.log -f html -o drift.html
  kubectl logs pod/api-7f9 | logdrift yesterday.log -
  logdrift good.log bad.log -f md >> "$GITHUB_STEP_SUMMARY"
`

type config struct {
	format   string
	output   string
	top      int
	context  int
	ignore   []*regexp.Regexp
	quorum   float64
	minStall float64
	sim      float64
	depth    int
	color    string
	exitZero bool
	help     bool
	files    []string
}

// Main runs the command line and returns the process exit code.
func Main(args []string, stdout, stderr io.Writer) int {
	cmd := "diff"
	if len(args) > 0 {
		switch args[0] {
		case "diff", "templates":
			cmd, args = args[0], args[1:]
		case "version", "--version", "-V":
			fmt.Fprintln(stdout, "logdrift", Version)
			return ExitClean
		case "help":
			fmt.Fprint(stdout, usage)
			return ExitClean
		}
	}
	cfg, err := parse(args)
	if err != nil {
		fmt.Fprintf(stderr, "logdrift: %v\n\nRun 'logdrift --help' for usage.\n", err)
		return ExitError
	}
	if cfg.help {
		fmt.Fprint(stdout, usage)
		return ExitClean
	}
	if cmd == "templates" {
		err = runTemplates(cfg, stdout)
		if err != nil {
			fmt.Fprintf(stderr, "logdrift: %v\n", err)
			return ExitError
		}
		return ExitClean
	}
	code, err := runDiff(cfg, stdout)
	if err != nil {
		fmt.Fprintf(stderr, "logdrift: %v\n", err)
		return ExitError
	}
	return code
}

func parse(args []string) (*config, error) {
	cfg := &config{format: "text", top: 0, context: 4, quorum: 1, minStall: 1, sim: drain.DefaultConfig.Similarity, depth: drain.DefaultConfig.Depth, color: "auto"}
	onlyFiles := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		if onlyFiles || a == "-" || !strings.HasPrefix(a, "-") {
			cfg.files = append(cfg.files, a)
			continue
		}
		if a == "--" {
			onlyFiles = true
			continue
		}
		name, val, hasVal := a, "", false
		if strings.HasPrefix(a, "--") {
			if eq := strings.IndexByte(a, '='); eq > 0 {
				name, val, hasVal = a[:eq], a[eq+1:], true
			}
		} else if len(a) > 2 {
			// -n5 style
			name, val, hasVal = a[:2], a[2:], true
		}
		value := func() (string, error) {
			if hasVal {
				return val, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("flag %s needs a value", name)
			}
			i++
			return args[i], nil
		}
		var err error
		var v string
		switch name {
		case "-h", "--help":
			cfg.help = true
		case "--exit-zero":
			cfg.exitZero = true
		case "-f", "--format":
			if v, err = value(); err == nil {
				cfg.format = strings.ToLower(v)
				if cfg.format == "markdown" {
					cfg.format = "md"
				}
				switch cfg.format {
				case "text", "json", "md", "html":
				default:
					err = fmt.Errorf("unknown format %q (want text, json, md or html)", v)
				}
			}
		case "-o", "--output":
			cfg.output, err = value()
		case "-n", "--top":
			if v, err = value(); err == nil {
				cfg.top, err = positiveInt(name, v)
			}
		case "-C", "--context":
			if v, err = value(); err == nil {
				cfg.context, err = strconv.Atoi(v)
				if err != nil || cfg.context < 0 {
					err = fmt.Errorf("%s: want a non-negative integer, got %q", name, v)
				}
				if cfg.context == 0 {
					cfg.context = -1 // explicit zero
				}
			}
		case "-i", "--ignore":
			if v, err = value(); err == nil {
				var re *regexp.Regexp
				if re, err = regexp.Compile(v); err == nil {
					cfg.ignore = append(cfg.ignore, re)
				} else {
					err = fmt.Errorf("%s: %v", name, err)
				}
			}
		case "--quorum":
			if v, err = value(); err == nil {
				cfg.quorum, err = fraction(name, v)
			}
		case "-s", "--sim":
			if v, err = value(); err == nil {
				cfg.sim, err = fraction(name, v)
			}
		case "--depth":
			if v, err = value(); err == nil {
				cfg.depth, err = positiveInt(name, v)
			}
		case "--min-stall":
			if v, err = value(); err == nil {
				cfg.minStall, err = seconds(name, v)
			}
		case "--color", "--colour":
			if v, err = value(); err == nil {
				cfg.color = v
				if v != "auto" && v != "always" && v != "never" {
					err = fmt.Errorf("%s: want auto, always or never, got %q", name, v)
				}
			}
		default:
			err = fmt.Errorf("unknown flag %s", a)
		}
		if err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

func positiveInt(name, v string) (int, error) {
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s: want a positive integer, got %q", name, v)
	}
	return n, nil
}

func fraction(name, v string) (float64, error) {
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 || f > 1 {
		return 0, fmt.Errorf("%s: want a number in (0, 1], got %q", name, v)
	}
	return f, nil
}

func seconds(name, v string) (float64, error) {
	if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
		return f, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%s: want a duration such as 500ms or 2s, got %q", name, v)
	}
	return d.Seconds(), nil
}

func (c *config) engine() *analyze.Engine {
	ctx := c.context
	return analyze.New(analyze.Options{
		Drain:    drain.Config{Similarity: c.sim, Depth: c.depth, MaxChildren: drain.DefaultConfig.MaxChildren},
		Quorum:   c.quorum,
		MinStall: c.minStall,
		Context:  ctx,
	})
}

func feed(e *analyze.Engine, path string, opts ingest.Options) error {
	rc, err := ingest.Open(path)
	if err != nil {
		return err
	}
	defer rc.Close()
	if err := ingest.Scan(rc, opts, func(rec ingest.Record) error { e.Add(rec); return nil }); err != nil {
		return fmt.Errorf("%s: %w", displayName(path), err)
	}
	return nil
}

func displayName(path string) string {
	if path == "-" {
		return "stdin"
	}
	return path
}

func checkStdin(files []string) error {
	n := 0
	for _, f := range files {
		if f == "-" {
			n++
		}
	}
	if n > 1 {
		return errors.New(`standard input ("-") can only be used once`)
	}
	return nil
}

func runDiff(cfg *config, stdout io.Writer) (int, error) {
	if len(cfg.files) < 2 {
		return ExitError, errors.New("need at least one baseline and one target log")
	}
	if err := checkStdin(cfg.files); err != nil {
		return ExitError, err
	}
	e := cfg.engine()
	in := ingest.Options{Ignore: cfg.ignore}
	baselines, target := cfg.files[:len(cfg.files)-1], cfg.files[len(cfg.files)-1]
	for _, b := range baselines {
		if err := e.BeginBaseline(displayName(b)); err != nil {
			return ExitError, err
		}
		if err := feed(e, b, in); err != nil {
			return ExitError, err
		}
	}
	if err := e.BeginTarget(displayName(target)); err != nil {
		return ExitError, err
	}
	if err := feed(e, target, in); err != nil {
		return ExitError, err
	}
	r := e.Report()

	out, closeOut, err := openOutput(cfg.output, stdout)
	if err != nil {
		return ExitError, err
	}
	ropts := report.Options{Top: cfg.top, Width: termWidth(out), Color: useColor(cfg.color, out), Version: Version}
	switch cfg.format {
	case "json":
		err = report.JSON(out, r, ropts)
	case "md":
		err = report.Markdown(out, r, ropts)
	case "html":
		err = report.HTML(out, r, ropts)
	default:
		err = report.Text(out, r, ropts)
	}
	if cerr := closeOut(); err == nil {
		err = cerr
	}
	if err != nil {
		return ExitError, err
	}
	if r.Summary.Drift && !cfg.exitZero {
		return ExitDrift, nil
	}
	return ExitClean, nil
}

func runTemplates(cfg *config, stdout io.Writer) error {
	if len(cfg.files) == 0 {
		return errors.New("templates: need at least one log file")
	}
	if err := checkStdin(cfg.files); err != nil {
		return err
	}
	if cfg.format != "text" && cfg.format != "json" {
		return fmt.Errorf("templates: format must be text or json")
	}
	e := cfg.engine()
	for _, f := range cfg.files {
		if err := e.BeginBaseline(displayName(f)); err != nil {
			return err
		}
		if err := feed(e, f, ingest.Options{Ignore: cfg.ignore}); err != nil {
			return err
		}
	}
	ts := e.Templates()
	sort.SliceStable(ts, func(i, j int) bool { return ts[i].Count > ts[j].Count })
	if cfg.top > 0 && len(ts) > cfg.top {
		ts = ts[:cfg.top]
	}
	out, closeOut, err := openOutput(cfg.output, stdout)
	if err != nil {
		return err
	}
	if cfg.format == "json" {
		err = report.TemplatesJSON(out, ts)
	} else {
		err = report.TemplatesText(out, ts, report.Options{Width: termWidth(out), Color: useColor(cfg.color, out)})
	}
	if cerr := closeOut(); err == nil {
		err = cerr
	}
	return err
}

func openOutput(path string, stdout io.Writer) (io.Writer, func() error, error) {
	if path == "" || path == "-" {
		return stdout, func() error { return nil }, nil
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, nil, err
	}
	return f, f.Close, nil
}

func useColor(when string, w io.Writer) bool {
	switch when {
	case "always":
		return true
	case "never":
		return false
	}
	if os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	if os.Getenv("FORCE_COLOR") != "" || os.Getenv("CLICOLOR_FORCE") != "" {
		return true
	}
	return isTerminal(w)
}

func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

func termWidth(w io.Writer) int {
	if c, err := strconv.Atoi(os.Getenv("COLUMNS")); err == nil && c > 0 {
		return c
	}
	if f, ok := w.(*os.File); ok && isTerminal(w) {
		if n := ttyWidth(f); n > 0 {
			return n
		}
	}
	return 100
}
