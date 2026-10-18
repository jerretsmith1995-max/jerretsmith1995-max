package analyze

import (
	"math"
	"math/bits"
	"regexp"
	"sort"
	"strings"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/token"
)

var errorRe = regexp.MustCompile(`(?i)(\b(error|err|fatal|panic|exception|fail|failed|failure|crit|critical|traceback|refused|denied|timeout|abort|aborted|segfault|unavailable|unreachable|killed|oom)\b|timed out|exceeded)`)

// IsErrorish reports whether a template reads like an error.
func IsErrorish(s string) bool { return errorRe.MatchString(s) }

// Keys whose values identify rather than describe; never compared.
var identityKeys = map[string]bool{
	"pid": true, "ppid": true, "tid": true, "port": true, "thread": true, "threadid": true,
	"seq": true, "sequence": true, "offset": true, "session": true, "sessionid": true,
	"trace": true, "traceid": true, "span": true, "spanid": true, "id": true, "reqid": true,
	"requestid": true, "request": true, "uptime": true, "ts": true, "time": true, "timestamp": true,
	"date": true, "nonce": true, "token": true, "key": true, "hash": true, "uuid": true, "guid": true,
}

func isIdentityKey(name string) bool {
	k := strings.ToLower(strings.Trim(name, `"'`))
	k = strings.NewReplacer("_", "", "-", "", ".", "").Replace(k)
	if identityKeys[k] {
		return true
	}
	l := strings.ToLower(name)
	return strings.HasSuffix(l, "_id") || strings.HasSuffix(l, "-id") || strings.HasSuffix(l, ".id") || strings.HasSuffix(name, "ID") || strings.HasSuffix(name, "Id")
}

// Report computes all findings. It may be called once the target is complete.
func (e *Engine) Report() *Report {
	r := &Report{
		Baselines: e.baselines,
		Templates: len(e.stats),
	}
	if e.target != nil {
		r.Target = *e.target
	}
	nBase := len(e.baselines)
	for _, st := range e.stats {
		for len(st.base) < nBase {
			st.base = append(st.base, 0)
			st.baseFirst = append(st.baseFirst, -1)
		}
	}

	byCluster := make(map[int32][]int)
	for i := range e.tlines {
		c := e.tlines[i].cluster
		byCluster[c] = append(byCluster[c], i)
	}

	e.findNovel(r)
	expected := e.findVanished(r)
	e.findShifts(r, byCluster)
	e.findParamDrift(r, byCluster)
	e.findStalls(r)
	e.findTransitions(r)
	e.findProgress(r, expected)
	e.finish(r)
	return r
}

func (e *Engine) tmpl(id int) string { return e.miner.Cluster(id).Template() }

func (e *Engine) findNovel(r *Report) {
	for id, st := range e.stats {
		if st.target == 0 || st.baseTotal() > 0 {
			continue
		}
		t := e.tmpl(id)
		nt := NovelTemplate{Template: t, Count: st.target, FirstLine: st.tFirst, LastLine: st.tLast, Error: IsErrorish(t), Sample: st.tSample}
		r.Novel = append(r.Novel, nt)
	}
	sort.SliceStable(r.Novel, func(i, j int) bool { return r.Novel[i].FirstLine < r.Novel[j].FirstLine })
	for i := range e.tlines {
		if e.stats[e.tlines[i].cluster].baseTotal() == 0 {
			e.tlines[i].marks |= MarkNovel
		}
	}
}

type milestone struct {
	id  int
	pos float64
}

// absenceSurprise is the Poisson rate above which never seeing a sporadic
// template is surprising: P(0 | λ) = e^-λ < 1%.
const absenceSurprise = 4.6

func (e *Engine) findVanished(r *Report) []milestone {
	nBase := len(e.baselines)
	if nBase == 0 {
		return nil
	}
	need := ceilFrac(e.opts.Quorum, nBase)
	scale := e.lengthScale()
	var ms []milestone
	for id, st := range e.stats {
		if st.baseRuns() < need {
			continue
		}
		if st.target == 0 && !e.absenceMatters(st, scale) {
			// A sporadic template (a retry that fires ~3 times a run) can be
			// absent by chance; leave it out of the milestone list entirely.
			continue
		}
		pos, n := 0.0, 0
		for run, first := range st.baseFirst {
			if first >= 0 && e.baselines[run].Lines > 0 {
				pos += float64(first) / float64(e.baselines[run].Lines)
				n++
			}
		}
		if n > 0 {
			pos /= float64(n)
		}
		ms = append(ms, milestone{id, pos})
	}
	sort.SliceStable(ms, func(i, j int) bool {
		if ms[i].pos != ms[j].pos {
			return ms[i].pos < ms[j].pos
		}
		return ms[i].id < ms[j].id
	})
	for _, m := range ms {
		st := e.stats[m.id]
		if st.target > 0 {
			continue
		}
		r.Vanished = append(r.Vanished, VanishedTemplate{
			Template:   e.tmpl(m.id),
			BaseCounts: append([]int(nil), st.base...),
			Position:   m.pos,
			Sample:     st.sample,
		})
	}
	return ms
}

// absenceMatters decides whether a template missing from the target is a
// finding. Deterministic templates (same count in every baseline, or a
// once-or-twice-per-run line when there is only one baseline) always matter;
// sporadic ones only when their expected count makes absence improbable.
func (e *Engine) absenceMatters(st *cstats, scale float64) bool {
	// Judge determinism over the runs that produced the template at all
	// (with a quorum below 1, some baselines legitimately lack it).
	lo, hi, sum, runs := math.MaxInt, 0, 0, 0
	for _, c := range st.base {
		if c > 0 {
			lo, hi = min(lo, c), max(hi, c)
			runs++
		}
		sum += c
	}
	if runs >= 2 && lo == hi {
		return true
	}
	if runs == 1 && hi <= 2 {
		return true
	}
	mean := float64(sum) / float64(len(st.base))
	return mean*math.Min(scale, 1) >= absenceSurprise
}

// lengthScale is target length relative to the mean baseline length.
func (e *Engine) lengthScale() float64 {
	if len(e.baselines) == 0 || e.target == nil {
		return 1
	}
	mean := 0.0
	for _, b := range e.baselines {
		mean += float64(b.Lines)
	}
	mean /= float64(len(e.baselines))
	if mean == 0 {
		return 1
	}
	return float64(e.target.Lines) / mean
}

func (e *Engine) findShifts(r *Report, byCluster map[int32][]int) {
	nBase := len(e.baselines)
	if nBase == 0 || e.target == nil {
		return
	}
	scale := e.lengthScale()
	for id, st := range e.stats {
		if st.target == 0 || st.baseTotal() == 0 {
			continue
		}
		bmin, bmax, sum := math.MaxInt, 0, 0
		for _, c := range st.base {
			bmin = min(bmin, c)
			bmax = max(bmax, c)
			sum += c
		}
		mean := float64(sum) / float64(nBase)
		expected := mean * scale
		t := st.target
		tf := float64(t)
		dir := ""
		switch {
		case t >= 5 && tf > 3*float64(bmax) && t > bmax+3 && tf > 3*expected:
			dir = "up"
		case bmin >= 6 && 3*tf < float64(bmin) && 3*tf < expected:
			dir = "down"
		}
		if dir == "" {
			continue
		}
		r.Shifted = append(r.Shifted, Shift{
			Template: e.tmpl(id), Target: t, BaseMin: bmin, BaseMax: bmax, BaseMean: mean,
			Expected: expected, Factor: (tf + 1) / (mean + 1), Direction: dir, FirstLine: st.tFirst,
		})
		if dir == "up" {
			for _, i := range byCluster[int32(id)] {
				e.tlines[i].marks |= MarkShift
			}
		}
	}
	sort.SliceStable(r.Shifted, func(i, j int) bool {
		a, b := math.Abs(math.Log(r.Shifted[i].Factor)), math.Abs(math.Log(r.Shifted[j].Factor))
		if a != b {
			return a > b
		}
		return r.Shifted[i].FirstLine < r.Shifted[j].FirstLine
	})
}

// slotName gives a human name to template position pos.
func slotName(tokens []string, pos int) string {
	t := tokens[pos]
	if k := token.KeyPrefix(t); k != "" {
		return strings.TrimLeft(strings.TrimSuffix(k, "="), "([{<\"'`")
	}
	for p := pos - 1; p >= 0 && p >= pos-3; p-- {
		prev := tokens[p]
		if token.HasMask(prev) {
			continue
		}
		w := strings.Trim(prev, "()[]{}<>\"'`,;:.!?=@#|-+*/\\&%$~^")
		if w != "" {
			return "after " + w
		}
	}
	return "#" + itoa(pos+1)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// significance is the p-value below which new categorical values count as drift.
const significance = 1e-3

// categorical decides how a baseline slot should be compared.
//
//	constSlot   the slot held one literal word in every baseline line (the
//	            message text itself), or one structured identifier such as a
//	            version that several baseline runs agreed on; any change is
//	            meaningful.
//	setSlot     a small, recurring set of values; new values are tested for
//	            significance against the Good–Turing estimate of how often
//	            the baseline itself produced never-before-seen values.
//	noSlot      neither; numeric analysis may still apply.
func (e *Engine) categorical(b *slot) slotKind {
	d := b.distinct()
	if b.overflow || d == 0 {
		return noSlot
	}
	if len(e.baselines) >= 2 {
		// With several baselines, demand that the values recur across runs:
		// a value only one run ever produced (a PID, a hostname) is not a
		// behavior, it is an identity.
		covered, runs := 0, uint64(0)
		for _, vs := range b.counts {
			runs |= vs.runs
			if bits.OnesCount64(vs.runs) >= 2 {
				covered += vs.n
			}
		}
		if bits.OnesCount64(runs) >= 2 && float64(covered) < 0.9*float64(b.total) {
			return noSlot
		}
	}
	if d == 1 && b.kinds == 1<<token.Literal {
		return constSlot
	}
	if d == 1 && b.kinds == 1<<token.ID {
		// A structured identifier (a version, a path with numbers in it)
		// that every baseline run agreed on is configuration: a change is
		// meaningful. One run is not enough to tell it from a per-run name.
		for _, vs := range b.counts {
			if bits.OnesCount64(vs.runs) >= 2 {
				return constSlot
			}
		}
		return noSlot
	}
	if b.total < 4 || d > maxStableSet || d*3 > b.total {
		return noSlot
	}
	return setSlot
}

type slotKind int

const (
	noSlot slotKind = iota
	constSlot
	setSlot
)

// unseenRate estimates the probability that the next baseline value would be
// one never seen before (Good–Turing: singletons / total, smoothed).
func unseenRate(b *slot) float64 {
	n1 := 0
	for _, vs := range b.counts {
		if vs.n == 1 {
			n1++
		}
	}
	return float64(n1+1) / float64(b.total+2)
}

// binomTail returns P(X >= k) for X ~ Binomial(n, p).
func binomTail(n, k int, p float64) float64 {
	if k <= 0 {
		return 1
	}
	if k > n || p <= 0 {
		return 0
	}
	if p >= 1 {
		return 1
	}
	if float64(k) <= float64(n)*p {
		return 1 // at or below the mean: not surprising
	}
	lp, lq := math.Log(p), math.Log1p(-p)
	lg := func(x int) float64 { v, _ := math.Lgamma(float64(x) + 1); return v }
	logC := lg(n) - lg(k) - lg(n-k)
	term := math.Exp(logC + float64(k)*lp + float64(n-k)*lq)
	sum := term
	for i := k + 1; i <= n; i++ {
		// pmf(i)/pmf(i-1) = (n-i+1)/i * p/q
		term *= float64(n-i+1) / float64(i) * p / (1 - p)
		sum += term
		if term < sum*1e-12 {
			break
		}
	}
	return math.Min(1, sum)
}

type driftCheck struct {
	id    int
	pd    ParamDrift
	pos   int
	isNew func(v string) bool
}

func (e *Engine) findParamDrift(r *Report, byCluster map[int32][]int) {
	var checks []driftCheck
	for id, st := range e.stats {
		if st.target == 0 || st.baseTotal() == 0 {
			continue
		}
		tokens := e.miner.Cluster(id).Tokens
		for pos := 0; pos < len(tokens) && pos < len(st.bslots) && pos < len(st.tslots); pos++ {
			b, t := st.bslots[pos], st.tslots[pos]
			name := slotName(tokens, pos)
			if isIdentityKey(strings.TrimPrefix(name, "after ")) {
				continue
			}
			if b.onlyOpaque() {
				continue
			}
			base := ParamDrift{Template: e.tmpl(id), Slot: name, Position: pos, TargetN: t.total}
			if kind := e.categorical(b); kind != noSlot {
				newVals := topValues(t.counts, 0, func(v string) bool { _, ok := b.counts[v]; return !ok })
				if len(newVals) == 0 {
					continue
				}
				n := 0
				for _, v := range newVals {
					n += v.Count
				}
				score := 6.0
				if kind == setSlot {
					pv := binomTail(t.total, n, unseenRate(b))
					if pv >= significance {
						continue
					}
					score = 4
				}
				pd := base
				pd.Kind = "categorical"
				pd.BaseValues = topValues(b.counts, maxStableSet, nil)
				pd.NewValues = newVals
				if len(pd.NewValues) > 8 {
					pd.NewValues = pd.NewValues[:8]
				}
				pd.NewCount = n
				pd.score = score + float64(n)/float64(max(1, t.total))
				bc := b.counts
				checks = append(checks, driftCheck{id: id, pd: pd, pos: pos, isNew: func(v string) bool { _, ok := bc[v]; return !ok }})
				continue
			}
			if b.numericFrac() < 0.9 || t.numericFrac() < 0.9 || b.dimMix || t.dimMix || b.dim != t.dim {
				continue
			}
			if len(b.samples) < 5 || len(t.samples) < 1 || b.isCounter() {
				continue
			}
			if b.distinct() <= 1 && !b.overflow {
				continue // a literal number (e.g. "HTTP/1.1 200"): categorical rules apply
			}
			bs, ts := b.sortedSamples(), t.sortedSamples()
			bp05, bp50, bp95 := quantile(bs, 0.05), quantile(bs, 0.5), quantile(bs, 0.95)
			tp50, tp95 := quantile(ts, 0.5), quantile(ts, 0.95)
			var isNew func(string) bool
			switch {
			case bp95 > 0 && tp50 > 2*bp95 && (bp50 <= 0 || tp50 > 3*bp50):
				hi := 2 * bp95
				isNew = func(v string) bool { x, _, ok := token.Quantity(v); return ok && x > hi }
			case bp05 > 0 && tp50 < bp05/2 && tp50 < bp50/3:
				lo := bp05 / 2
				isNew = func(v string) bool { x, _, ok := token.Quantity(v); return ok && x < lo }
			default:
				continue
			}
			pd := base
			pd.Kind = "numeric"
			pd.Dimension = b.dim.String()
			pd.BaseP50, pd.BaseP95, pd.TargetP50, pd.TargetP95 = bp50, bp95, tp50, tp95
			switch {
			case bp50 > 0 && tp50 > 0:
				pd.Factor = tp50 / bp50
			case tp50 > bp50:
				pd.Factor = math.Inf(1)
			}
			f := pd.Factor
			if f <= 0 || math.IsInf(f, 0) {
				pd.score = 10
			} else {
				pd.score = math.Abs(math.Log2(f))
			}
			checks = append(checks, driftCheck{id: id, pd: pd, pos: pos, isNew: isNew})
		}
	}

	var toks []token.Token
	for _, c := range checks {
		pd := c.pd
		for _, i := range byCluster[int32(c.id)] {
			tl := &e.tlines[i]
			toks = token.Tokenize(tl.body, toks[:0])
			if c.pos >= len(toks) || !c.isNew(toks[c.pos].Value) {
				continue
			}
			tl.marks |= MarkParam
			if pd.FirstLine == 0 {
				pd.FirstLine = tl.no
				pd.Sample = clip(tl.raw)
			}
		}
		r.ParamDrift = append(r.ParamDrift, pd)
	}
	sort.SliceStable(r.ParamDrift, func(i, j int) bool {
		a, b := r.ParamDrift[i], r.ParamDrift[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.FirstLine != b.FirstLine {
			return a.FirstLine < b.FirstLine
		}
		return a.Position < b.Position
	})
}

func (e *Engine) findStalls(r *Report) {
	if len(e.baseGaps) == 0 || e.target == nil || !e.target.Timestamps {
		return
	}
	gaps := append([]float64(nil), e.baseGaps...)
	sort.Float64s(gaps)
	global := quantile(gaps, 0.99)
	minStall := e.opts.MinStall
	for i := range e.tlines {
		tl := &e.tlines[i]
		if tl.gap < minStall {
			continue
		}
		st := e.stats[tl.cluster]
		ref := global
		if st.gapN > 0 {
			ref = st.gapMax
		}
		if tl.gap > 3*ref && tl.gap-ref >= minStall {
			tl.marks |= MarkStall
			r.Stalls = append(r.Stalls, Stall{Line: tl.no, Gap: tl.gap, Reference: ref, Template: e.tmpl(int(tl.cluster)), Text: clip(tl.raw)})
		}
	}
	sort.SliceStable(r.Stalls, func(i, j int) bool { return r.Stalls[i].Gap > r.Stalls[j].Gap })
}

func (e *Engine) findTransitions(r *Report) {
	prev := -1
	for i := range e.tlines {
		tl := &e.tlines[i]
		if tl.trans && prev >= 0 {
			tl.marks |= MarkTransition
			r.Summary.NovelTransitions++
			if len(r.Transitions) < maxTransitions {
				r.Transitions = append(r.Transitions, Transition{Line: tl.no, From: e.tmpl(prev), To: e.tmpl(int(tl.cluster))})
			}
		}
		prev = int(tl.cluster)
	}
}

func (e *Engine) findProgress(r *Report, ms []milestone) {
	if len(ms) == 0 || e.target == nil {
		return
	}
	p := &Progress{Expected: len(ms)}
	missedAt := -1
	for i, m := range ms {
		if e.stats[m.id].target > 0 {
			p.Reached++
		} else if missedAt < 0 {
			missedAt = i
		}
	}
	if missedAt >= 0 {
		p.FirstMissed = e.tmpl(ms[missedAt].id)
		for i := missedAt - 1; i >= 0; i-- {
			if st := e.stats[ms[i].id]; st.target > 0 {
				p.LastReached = e.tmpl(ms[i].id)
				p.LastReachedLine = st.tFirst
				break
			}
		}
	}
	r.Progress = p
}

func (e *Engine) finish(r *Report) {
	s := &r.Summary
	s.Novel = len(r.Novel)
	for _, n := range r.Novel {
		if n.Error {
			s.NovelErrors++
		}
	}
	s.Vanished = len(r.Vanished)
	s.Shifted = len(r.Shifted)
	s.ParamDrift = len(r.ParamDrift)
	s.Stalls = len(r.Stalls)
	s.Drift = s.Novel+s.Vanished+s.Shifted+s.ParamDrift+s.Stalls > 0

	// First divergence: the earliest line carrying a strong signal.
	focus := -1
	if !s.Drift {
		focus = -2 // nothing to point at; skip the search below
	}
	reason := ""
	for i := 0; focus == -1 && i < len(e.tlines); i++ {
		m := e.tlines[i].marks
		switch {
		case m&MarkNovel != 0:
			reason = "first template never seen in baseline"
		case m&MarkParam != 0:
			reason = "first parameter value outside baseline behavior"
		case m&MarkStall != 0:
			reason = "first unusual silence"
		default:
			continue
		}
		focus = i
	}
	if focus == -1 && r.Progress != nil && r.Progress.LastReachedLine > 0 {
		for i := range e.tlines {
			if e.tlines[i].no == r.Progress.LastReachedLine {
				focus, reason = i, "last baseline milestone before the target stopped matching"
				break
			}
		}
	}
	if focus == -1 && len(r.Shifted) > 0 {
		for i := range e.tlines {
			if e.tlines[i].marks&MarkShift != 0 {
				focus, reason = i, "first occurrence of a template whose frequency shifted"
				break
			}
		}
	}
	if focus >= 0 {
		tl := e.tlines[focus]
		s.FirstDivergence = &Divergence{Line: tl.no, Reason: reason, Text: clip(tl.raw)}
		lo, hi := max(0, focus-e.opts.Context), min(len(e.tlines)-1, focus+e.opts.Context)
		for i := lo; i <= hi; i++ {
			c := e.tlines[i]
			r.Context = append(r.Context, ContextLine{Line: c.no, Text: clip(c.raw), Marks: c.marks, Focus: i == focus})
		}
	}

	r.LineMarks = make([]uint8, len(e.tlines))
	r.LineNos = make([]int, len(e.tlines))
	for i, tl := range e.tlines {
		r.LineMarks[i] = tl.marks
		r.LineNos[i] = tl.no
		if tl.marks != 0 && tl.marks != MarkTransition && len(r.Marked) < maxMarkedLines {
			r.Marked = append(r.Marked, ContextLine{Line: tl.no, Text: clip(tl.raw), Marks: tl.marks})
		}
	}
}
