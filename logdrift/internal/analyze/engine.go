// Package analyze compares the behavior of a target log against one or more
// baseline logs. Every line of every run is mined into a shared template
// space (package drain); the engine then keeps compact per-template
// statistics for each side and derives findings from them:
//
//	novel        templates only the target produced
//	vanished     templates every baseline produced but the target never did
//	shifted      templates whose frequency left the baseline envelope
//	param drift  templates whose parameters changed (new categorical values,
//	             or a numeric distribution that moved by a large factor)
//	stalls       silences far longer than baseline ever had at that point
//	transitions  adjacent template pairs the baseline never produced
//
// Baselines must be fed completely before the target. Memory for baselines is
// bounded by the number of templates, not the number of lines.
package analyze

import (
	"errors"
	"math"
	"time"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/drain"
	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/ingest"
	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/token"
)

// Options tune the analysis. The zero value is usable.
type Options struct {
	Drain    drain.Config
	Quorum   float64 // fraction of baselines that must contain a template for it to count as expected (default 1)
	MinStall float64 // minimum silence in seconds to report as a stall (default 1)
	Context  int     // lines of context around the first divergence (default 4)
}

func (o *Options) normalize() {
	if o.Quorum <= 0 || o.Quorum > 1 {
		o.Quorum = 1
	}
	if o.MinStall <= 0 {
		o.MinStall = 1
	}
	if o.Context < 0 {
		o.Context = 0
	} else if o.Context == 0 {
		o.Context = 4
	}
}

const (
	maxGapSamples   = 1 << 16
	maxTransitions  = 50
	maxMarkedLines  = 5000
	maxSampleLength = 400
)

// Engine accumulates runs and produces a Report.
type Engine struct {
	opts  Options
	miner *drain.Miner
	stats []*cstats

	baselines []RunSummary
	target    *RunSummary
	run       int // index of current baseline run
	inTarget  bool

	prevCluster int
	prevTS      time.Time
	hasPrevTS   bool
	ordinal     int // record index within the current run

	baseTrans map[uint64]struct{}
	baseGaps  []float64
	gapSeen   int
	gapRNG    uint64

	tlines []tline

	tokBuf []token.Token
	strBuf []string
}

type cstats struct {
	base      []int // occurrences per baseline run
	baseFirst []int // record ordinal of first occurrence per baseline run (-1 if none)
	target    int
	tFirst    int // first target line number (0 = none)
	tLast     int

	bslots []*slot
	tslots []*slot

	gapMax float64 // longest silence preceding this template in any baseline
	gapN   int

	sample  string // first baseline line
	tSample string // first target line
}

type tline struct {
	no      int
	raw     string
	body    string
	cluster int32
	gap     float64 // seconds since previous timestamped line, or -1
	trans   bool    // novel transition into this line
	marks   uint8
}

// New returns an engine configured by opts.
func New(opts Options) *Engine {
	opts.normalize()
	return &Engine{
		opts:      opts,
		miner:     drain.New(opts.Drain),
		run:       -1,
		baseTrans: map[uint64]struct{}{},
		gapRNG:    0x2545f4914f6cdd1d,
	}
}

// ErrOrder is returned when a baseline is started after the target.
var ErrOrder = errors.New("analyze: baselines must be added before the target")

// BeginBaseline starts a new baseline run.
func (e *Engine) BeginBaseline(name string) error {
	if e.inTarget {
		return ErrOrder
	}
	e.baselines = append(e.baselines, RunSummary{Name: name})
	e.run = len(e.baselines) - 1
	e.resetRun()
	return nil
}

// BeginTarget starts the target run. It may be called once.
func (e *Engine) BeginTarget(name string) error {
	if e.inTarget {
		return errors.New("analyze: target already started")
	}
	e.inTarget = true
	e.target = &RunSummary{Name: name}
	e.resetRun()
	return nil
}

func (e *Engine) resetRun() {
	e.prevCluster = -1
	e.hasPrevTS = false
	e.ordinal = 0
}

// Add feeds one record into the current run.
func (e *Engine) Add(rec ingest.Record) {
	if !e.inTarget && e.run < 0 {
		e.BeginBaseline("baseline")
	}
	e.tokBuf = token.Tokenize(rec.Body, e.tokBuf[:0])
	if len(e.tokBuf) == 0 {
		return
	}
	e.strBuf = e.strBuf[:0]
	for _, t := range e.tokBuf {
		e.strBuf = append(e.strBuf, t.Text)
	}
	c := e.miner.Add(e.strBuf)
	for len(e.stats) <= c.ID {
		e.stats = append(e.stats, &cstats{})
	}
	st := e.stats[c.ID]

	gap := -1.0
	if rec.HasTS {
		if e.hasPrevTS {
			if d := rec.TS.Sub(e.prevTS).Seconds(); d >= 0 {
				gap = d
			}
		}
		e.prevTS, e.hasPrevTS = rec.TS, true
	}

	if e.inTarget {
		e.addTarget(rec, c.ID, st, gap)
	} else {
		e.addBaseline(rec, c.ID, st, gap)
	}
	e.prevCluster = c.ID
	e.ordinal++
}

func (e *Engine) addBaseline(rec ingest.Record, id int, st *cstats, gap float64) {
	run := e.run
	rs := &e.baselines[run]
	rs.Lines++
	rs.Timestamps = rs.Timestamps || rec.HasTS
	for len(st.base) <= run {
		st.base = append(st.base, 0)
		st.baseFirst = append(st.baseFirst, -1)
	}
	if st.base[run] == 0 {
		st.baseFirst[run] = e.ordinal
	}
	st.base[run]++
	if st.sample == "" {
		st.sample = clip(rec.Raw)
	}
	st.bslots = record(st.bslots, e.tokBuf, run)
	if gap >= 0 {
		if gap > st.gapMax {
			st.gapMax = gap
		}
		st.gapN++
		e.sampleGap(gap)
	}
	if e.prevCluster >= 0 {
		e.baseTrans[transKey(e.prevCluster, id)] = struct{}{}
	}
}

func (e *Engine) addTarget(rec ingest.Record, id int, st *cstats, gap float64) {
	e.target.Lines++
	e.target.Timestamps = e.target.Timestamps || rec.HasTS
	st.target++
	if st.tFirst == 0 {
		st.tFirst = rec.LineNo
		st.tSample = clip(rec.Raw)
	}
	st.tLast = rec.LineNo
	st.tslots = record(st.tslots, e.tokBuf, -1)

	tl := tline{no: rec.LineNo, raw: rec.Raw, body: rec.Body, cluster: int32(id), gap: gap}
	if e.prevCluster >= 0 {
		prev := e.stats[e.prevCluster]
		if _, ok := e.baseTrans[transKey(e.prevCluster, id)]; !ok && prev.baseTotal() > 0 && st.baseTotal() > 0 {
			tl.trans = true
		}
	}
	e.tlines = append(e.tlines, tl)
}

func record(slots []*slot, toks []token.Token, run int) []*slot {
	for len(slots) < len(toks) {
		slots = append(slots, newSlot())
	}
	for i, t := range toks {
		slots[i].add(t.Value, t.Kind, run)
	}
	return slots
}

func (e *Engine) sampleGap(g float64) {
	e.gapSeen++
	if len(e.baseGaps) < maxGapSamples {
		e.baseGaps = append(e.baseGaps, g)
		return
	}
	e.gapRNG ^= e.gapRNG << 13
	e.gapRNG ^= e.gapRNG >> 7
	e.gapRNG ^= e.gapRNG << 17
	if r := int(e.gapRNG % uint64(e.gapSeen)); r < maxGapSamples {
		e.baseGaps[r] = g
	}
}

func transKey(a, b int) uint64 { return uint64(uint32(a))<<32 | uint64(uint32(b)) }

func (s *cstats) baseTotal() int {
	n := 0
	for _, c := range s.base {
		n += c
	}
	return n
}

func (s *cstats) baseRuns() int {
	n := 0
	for _, c := range s.base {
		if c > 0 {
			n++
		}
	}
	return n
}

func clip(s string) string {
	if len(s) <= maxSampleLength {
		return s
	}
	cut := maxSampleLength
	for cut > 0 && s[cut]&0xc0 == 0x80 { // don't split a UTF-8 sequence
		cut--
	}
	return s[:cut] + "…"
}

// TemplateInfo describes a mined template (for the "templates" command).
type TemplateInfo struct {
	Template string `json:"template"`
	Count    int    `json:"count"`
	Sample   string `json:"sample"`
}

// Templates lists every mined template with its total occurrence count.
func (e *Engine) Templates() []TemplateInfo {
	out := make([]TemplateInfo, 0, len(e.stats))
	for id, st := range e.stats {
		s := st.sample
		if s == "" {
			s = st.tSample
		}
		out = append(out, TemplateInfo{Template: e.miner.Cluster(id).Template(), Count: st.baseTotal() + st.target, Sample: s})
	}
	return out
}

func ceilFrac(q float64, n int) int {
	k := int(math.Ceil(q*float64(n) - 1e-9))
	if k < 1 {
		k = 1
	}
	return k
}
