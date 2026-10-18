package analyze

// The types in this file form the public result of an analysis. They are
// plain data so they can be rendered as text, Markdown, HTML or JSON.

// Mark bits annotate individual target lines.
const (
	MarkNovel      uint8 = 1 << iota // line belongs to a template never seen in baseline
	MarkParam                        // a parameter took a value the baseline never produced
	MarkStall                        // an unusual silence preceded this line
	MarkShift                        // template whose frequency shifted
	MarkTransition                   // template order never seen in baseline
)

// Report is the full result of comparing baseline runs with a target run.
type Report struct {
	Baselines   []RunSummary       `json:"baselines"`
	Target      RunSummary         `json:"target"`
	Templates   int                `json:"templates"`
	Summary     Summary            `json:"summary"`
	Novel       []NovelTemplate    `json:"novel"`
	Vanished    []VanishedTemplate `json:"vanished"`
	Shifted     []Shift            `json:"shifted"`
	ParamDrift  []ParamDrift       `json:"param_drift"`
	Stalls      []Stall            `json:"stalls"`
	Transitions []Transition       `json:"transitions"`
	Progress    *Progress          `json:"progress,omitempty"`
	Context     []ContextLine      `json:"context,omitempty"`

	// LineMarks holds one Mark bitset per target record (in input order),
	// LineNos the matching physical line numbers. Used for timelines.
	LineMarks []uint8 `json:"-"`
	LineNos   []int   `json:"-"`
	// Marked lists the annotated target lines (capped) for interactive views.
	Marked []ContextLine `json:"-"`
}

// RunSummary describes one input log.
type RunSummary struct {
	Name       string `json:"name"`
	Lines      int    `json:"lines"`
	Timestamps bool   `json:"timestamps"`
}

// Summary counts findings and pinpoints the first divergence.
type Summary struct {
	Drift            bool        `json:"drift"`
	Novel            int         `json:"novel"`
	NovelErrors      int         `json:"novel_errors"`
	Vanished         int         `json:"vanished"`
	Shifted          int         `json:"shifted"`
	ParamDrift       int         `json:"param_drift"`
	Stalls           int         `json:"stalls"`
	NovelTransitions int         `json:"novel_transitions"`
	FirstDivergence  *Divergence `json:"first_divergence,omitempty"`
}

// Divergence is the earliest target line where behavior departs from baseline.
type Divergence struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
	Text   string `json:"text"`
}

// NovelTemplate is a template seen only in the target.
type NovelTemplate struct {
	Template  string `json:"template"`
	Count     int    `json:"count"`
	FirstLine int    `json:"first_line"`
	LastLine  int    `json:"last_line"`
	Error     bool   `json:"error"`
	Sample    string `json:"sample"`
}

// VanishedTemplate is expected (present in enough baselines) but absent in the target.
type VanishedTemplate struct {
	Template   string  `json:"template"`
	BaseCounts []int   `json:"base_counts"`
	Position   float64 `json:"position"` // mean relative position (0..1) in baseline runs
	Sample     string  `json:"sample"`
}

// Shift is a template whose frequency left the baseline envelope.
type Shift struct {
	Template  string  `json:"template"`
	Target    int     `json:"target"`
	BaseMin   int     `json:"base_min"`
	BaseMax   int     `json:"base_max"`
	BaseMean  float64 `json:"base_mean"`
	Expected  float64 `json:"expected"` // baseline mean scaled to target length
	Factor    float64 `json:"factor"`   // target / baseline mean (smoothed)
	Direction string  `json:"direction"`
	FirstLine int     `json:"first_line"`
}

// ValueCount is a parameter value and how often it occurred.
type ValueCount struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// ParamDrift is a template whose parameter slot changed behavior.
type ParamDrift struct {
	Template  string `json:"template"`
	Slot      string `json:"slot"`
	Position  int    `json:"position"`
	Kind      string `json:"kind"` // "categorical" or "numeric"
	FirstLine int    `json:"first_line"`
	Sample    string `json:"sample"`

	// categorical
	BaseValues []ValueCount `json:"base_values,omitempty"`
	NewValues  []ValueCount `json:"new_values,omitempty"`
	NewCount   int          `json:"new_count,omitempty"`
	TargetN    int          `json:"target_n"`

	// numeric (values in the dimension's base unit)
	Dimension string  `json:"dimension,omitempty"`
	BaseP50   float64 `json:"base_p50,omitempty"`
	BaseP95   float64 `json:"base_p95,omitempty"`
	TargetP50 float64 `json:"target_p50,omitempty"`
	TargetP95 float64 `json:"target_p95,omitempty"`
	Factor    float64 `json:"factor,omitempty"`

	score float64
}

// Stall is an unusually long silence before a target line.
type Stall struct {
	Line      int     `json:"line"`
	Gap       float64 `json:"gap_seconds"`
	Reference float64 `json:"reference_seconds"` // longest comparable gap in baseline
	Template  string  `json:"template"`
	Text      string  `json:"text"`
}

// Transition is an adjacent pair of templates never adjacent in baseline.
type Transition struct {
	Line int    `json:"line"`
	From string `json:"from"`
	To   string `json:"to"`
}

// Progress measures how far the target got through the baseline's milestones
// (templates every baseline run produces), in baseline order.
type Progress struct {
	Expected        int    `json:"expected"`
	Reached         int    `json:"reached"`
	FirstMissed     string `json:"first_missed,omitempty"`
	LastReached     string `json:"last_reached,omitempty"`
	LastReachedLine int    `json:"last_reached_line,omitempty"`
}

// ContextLine is a target line shown around the first divergence.
type ContextLine struct {
	Line  int    `json:"line"`
	Text  string `json:"text"`
	Marks uint8  `json:"marks"`
	Focus bool   `json:"focus,omitempty"`
}
