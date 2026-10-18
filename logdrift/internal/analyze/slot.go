package analyze

import (
	"math"
	"sort"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/token"
)

const (
	maxDistinct  = 256  // distinct values tracked per slot before it is "high cardinality"
	maxSamples   = 4096 // numeric reservoir size per slot
	maxStableSet = 6    // a categorical slot may have at most this many baseline values
)

// slot accumulates the values one template position took within one side
// (baseline or target) of the comparison. Memory is bounded regardless of
// input size.
type slot struct {
	total    int
	counts   map[string]*valueStat
	overflow bool
	kinds    uint16 // bitset of token.Kind seen

	numeric int
	dim     token.Dimension
	dimMix  bool
	samples []float64
	seen    int    // numeric values offered to the reservoir
	rng     uint64 // deterministic reservoir sampling

	// monotonic counter detection (per run)
	run      int
	last     float64
	hasLast  bool
	pairs    int
	rising   int
	constant int
}

type valueStat struct {
	n    int
	runs uint64 // bitset of baseline runs (first 64) that produced the value
}

func newSlot() *slot { return &slot{counts: map[string]*valueStat{}, rng: 0x9e3779b97f4a7c15} }

func (s *slot) add(value string, kind token.Kind, run int) {
	s.total++
	s.kinds |= 1 << kind
	if vs, ok := s.counts[value]; ok {
		vs.n++
		vs.runs |= runBit(run)
	} else if len(s.counts) < maxDistinct {
		s.counts[value] = &valueStat{n: 1, runs: runBit(run)}
	} else {
		s.overflow = true
	}

	if kind.Opaque() {
		return
	}
	v, dim, ok := token.Quantity(value)
	if !ok {
		return
	}
	if s.numeric == 0 {
		s.dim = dim
	} else if dim != s.dim {
		s.dimMix = true
	}
	s.numeric++
	s.reservoir(v)

	if run != s.run {
		s.run, s.hasLast = run, false
	}
	if s.hasLast {
		s.pairs++
		switch {
		case v > s.last:
			s.rising++
		case v == s.last:
			s.constant++
		}
	}
	s.last, s.hasLast = v, true
}

func runBit(run int) uint64 {
	if run < 0 || run >= 64 {
		return 0
	}
	return 1 << uint(run)
}

func (s *slot) reservoir(v float64) {
	s.seen++
	if len(s.samples) < maxSamples {
		s.samples = append(s.samples, v)
		return
	}
	// xorshift64*: cheap, deterministic, good enough for sampling.
	s.rng ^= s.rng >> 12
	s.rng ^= s.rng << 25
	s.rng ^= s.rng >> 27
	r := int((s.rng * 2685821657736338717) % uint64(s.seen))
	if r < maxSamples {
		s.samples[r] = v
	}
}

func (s *slot) distinct() int { return len(s.counts) }

func (s *slot) onlyOpaque() bool {
	if s.kinds == 0 {
		return false
	}
	opaque := uint16(1<<token.TS | 1<<token.UUID | 1<<token.HEX | 1<<token.IP)
	return s.kinds&^opaque == 0
}

// isCounter reports whether values mostly increase line over line, like a
// sequence number or uptime. Such slots differ between runs by construction.
func (s *slot) isCounter() bool {
	if s.pairs < 3 {
		return false
	}
	return float64(s.rising) >= 0.8*float64(s.pairs) && s.rising > s.constant
}

func (s *slot) numericFrac() float64 {
	if s.total == 0 {
		return 0
	}
	return float64(s.numeric) / float64(s.total)
}

func (s *slot) sortedSamples() []float64 {
	out := append([]float64(nil), s.samples...)
	sort.Float64s(out)
	return out
}

// quantile of sorted xs using linear interpolation.
func quantile(xs []float64, q float64) float64 {
	if len(xs) == 0 {
		return math.NaN()
	}
	if len(xs) == 1 {
		return xs[0]
	}
	pos := q * float64(len(xs)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	frac := pos - float64(lo)
	return xs[lo]*(1-frac) + xs[hi]*frac
}

// topValues returns values sorted by count (desc) then value, limited to n.
func topValues(m map[string]*valueStat, n int, keep func(string) bool) []ValueCount {
	out := make([]ValueCount, 0, len(m))
	for v, st := range m {
		if keep == nil || keep(v) {
			out = append(out, ValueCount{Value: v, Count: st.n})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Value < out[j].Value
	})
	if n > 0 && len(out) > n {
		out = out[:n]
	}
	return out
}
