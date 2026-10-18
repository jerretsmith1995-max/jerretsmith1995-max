// Package drain implements online log template mining in the style of the
// Drain algorithm (He et al., ICWS 2017): a fixed-depth prefix tree routes a
// token sequence by its length and its first few tokens to a small set of
// candidate clusters, and the most similar candidate absorbs the line,
// replacing positions that disagree with a wildcard.
//
// Two refinements over textbook Drain:
//   - tokens arrive pre-masked (see package token), so typed placeholders such
//     as <NUM> compare equal and never fragment the tree;
//   - wildcarding is key-aware: "mode=fast" and "mode=slow" generalize to
//     "mode=<*>" rather than a bare "<*>", keeping the template readable and
//     the slot nameable.
package drain

import (
	"strings"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/token"
)

// Wildcard is the generic parameter marker written into templates.
const Wildcard = "<*>"

// Config tunes the miner.
type Config struct {
	Similarity  float64 // minimum fraction of matching positions to join a cluster (0..1]
	Depth       int     // number of leading tokens used to route through the tree
	MaxChildren int     // fan-out cap per tree node; overflow routes to a wildcard child
}

// DefaultConfig is a good starting point for application logs.
var DefaultConfig = Config{Similarity: 0.5, Depth: 2, MaxChildren: 100}

// Cluster is one mined template.
type Cluster struct {
	ID     int
	Tokens []string
	Size   int
}

// Template renders the cluster's tokens as a single line.
func (c *Cluster) Template() string { return strings.Join(c.Tokens, " ") }

// Miner holds the prefix tree and all clusters. It is not safe for concurrent use.
type Miner struct {
	cfg      Config
	byLength map[int]*node
	clusters []*Cluster
}

type node struct {
	children map[string]*node
	clusters []int
}

// New returns an empty miner. Zero fields in cfg take their defaults.
func New(cfg Config) *Miner {
	if cfg.Similarity <= 0 || cfg.Similarity > 1 {
		cfg.Similarity = DefaultConfig.Similarity
	}
	if cfg.Depth <= 0 {
		cfg.Depth = DefaultConfig.Depth
	}
	if cfg.MaxChildren <= 0 {
		cfg.MaxChildren = DefaultConfig.MaxChildren
	}
	return &Miner{cfg: cfg, byLength: map[int]*node{}}
}

// Clusters returns all clusters, indexed by ID.
func (m *Miner) Clusters() []*Cluster { return m.clusters }

// Cluster returns the cluster with the given ID.
func (m *Miner) Cluster(id int) *Cluster { return m.clusters[id] }

// Add assigns tokens to a cluster, creating one if no existing cluster is
// similar enough, and returns it. tokens must be non-empty.
func (m *Miner) Add(tokens []string) *Cluster {
	leaf := m.leaf(tokens, true)
	if c := m.bestMatch(leaf, tokens); c != nil {
		for i, t := range tokens {
			if c.Tokens[i] != t {
				c.Tokens[i] = Generalize(c.Tokens[i], t)
			}
		}
		c.Size++
		return c
	}
	c := &Cluster{ID: len(m.clusters), Tokens: append([]string(nil), tokens...), Size: 1}
	m.clusters = append(m.clusters, c)
	leaf.clusters = append(leaf.clusters, c.ID)
	return c
}

// Match finds the cluster tokens would join, without modifying anything.
func (m *Miner) Match(tokens []string) *Cluster {
	leaf := m.leaf(tokens, false)
	if leaf == nil {
		return nil
	}
	return m.bestMatch(leaf, tokens)
}

// routeKey is the tree key for a routing token: masked tokens share the
// wildcard branch and key=value tokens route by their key alone. Other words
// route literally, which keeps distinct events ("postgres connected" vs
// "redis connected") apart even when they are otherwise similar.
func routeKey(t string) string {
	if k := token.KeyPrefix(t); k != "" {
		return k + Wildcard
	}
	if token.HasMask(t) {
		return Wildcard
	}
	return t
}

func (m *Miner) leaf(tokens []string, create bool) *node {
	n := len(tokens)
	cur, ok := m.byLength[n]
	if !ok {
		if !create {
			return nil
		}
		cur = &node{}
		m.byLength[n] = cur
	}
	depth := m.cfg.Depth
	if depth > n {
		depth = n
	}
	for i := 0; i < depth; i++ {
		key := routeKey(tokens[i])
		next, ok := cur.children[key]
		if !ok {
			if !create {
				next = cur.children[Wildcard]
				if next == nil {
					return nil
				}
			} else {
				if cur.children == nil {
					cur.children = map[string]*node{}
				}
				if len(cur.children) >= m.cfg.MaxChildren {
					key = Wildcard
				}
				next = cur.children[key]
				if next == nil {
					next = &node{}
					cur.children[key] = next
				}
			}
		}
		cur = next
	}
	return cur
}

func (m *Miner) bestMatch(leaf *node, tokens []string) *Cluster {
	var best *Cluster
	bestSim, bestWild := -1.0, -1
	for _, id := range leaf.clusters {
		c := m.clusters[id]
		sim, wild := similarity(c.Tokens, tokens)
		if sim > bestSim || (sim == bestSim && wild > bestWild) {
			best, bestSim, bestWild = c, sim, wild
		}
	}
	if best != nil && bestSim >= m.cfg.Similarity {
		return best
	}
	return nil
}

// similarity returns the fraction of positions where the template token
// equals the line token, plus the number of wildcard positions (used as a
// tie-breaker: the more general template wins). Wildcards themselves do not
// count as matches, so an all-wildcard template cannot swallow everything.
func similarity(tmpl, tokens []string) (float64, int) {
	eq, wild := 0, 0
	for i, t := range tmpl {
		if token.IsWildcard(t) {
			wild++
			if wildcardAccepts(t, tokens[i]) {
				// A keyed wildcard ("mode=<*>") still pins the key, so it
				// counts as a match; a bare "<*>" does not.
				if t != Wildcard {
					eq++
				}
			}
			continue
		}
		if t == tokens[i] {
			eq++
		}
	}
	return float64(eq) / float64(len(tmpl)), wild
}

func wildcardAccepts(tmpl, tok string) bool {
	if tmpl == Wildcard {
		return true
	}
	prefix := strings.TrimSuffix(tmpl, Wildcard)
	return strings.HasPrefix(tok, prefix)
}

// Generalize merges two disagreeing template tokens into a wildcard,
// preserving a shared "key=" prefix.
func Generalize(a, b string) string {
	if a == b {
		return a
	}
	ka := token.KeyPrefix(a)
	if ka == "" && strings.HasSuffix(a, "="+Wildcard) {
		ka = strings.TrimSuffix(a, Wildcard)
	}
	if ka != "" && strings.HasPrefix(b, ka) && len(b) > len(ka) {
		return ka + Wildcard
	}
	return Wildcard
}
