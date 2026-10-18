// Package token splits a log message into tokens and masks the variable parts
// (numbers, durations, IDs, addresses, ...) so that two lines that differ only
// in their parameters produce the same token sequence.
//
// Each token keeps two views:
//
//	Text  - the template form, e.g. "latency=<DUR>," (used for clustering)
//	Value - the raw variable part, e.g. "23ms"      (used for parameter analysis)
package token

import (
	"regexp"
	"strings"
)

// Kind classifies the variable part of a token.
type Kind uint8

const (
	Literal Kind = iota
	TS
	UUID
	IP
	HEX
	DUR
	SIZE
	NUM
	ID
	numKinds
)

var placeholders = [numKinds]string{"", "<TS>", "<UUID>", "<IP>", "<HEX>", "<DUR>", "<SIZE>", "<NUM>", "<ID>"}

var kindNames = [numKinds]string{"literal", "timestamp", "uuid", "ip", "hex", "duration", "size", "number", "id"}

// Placeholder returns the mask written into the template for k.
func (k Kind) Placeholder() string { return placeholders[k] }

func (k Kind) String() string {
	if k < numKinds {
		return kindNames[k]
	}
	return "unknown"
}

// Opaque reports whether values of this kind are identifiers whose exact
// value carries no behavioral meaning (so they are never compared).
func (k Kind) Opaque() bool { return k == TS || k == UUID || k == HEX || k == IP }

// Token is one whitespace-delimited unit of a log message.
type Token struct {
	Text  string
	Value string
	Kind  Kind
}

const (
	leadPunct  = "([{<\"'`#@+"
	trailPunct = ")]}>\"'`,;:.!?"
)

// Tokenize appends the tokens of s to dst and returns the extended slice.
func Tokenize(s string, dst []Token) []Token {
	i := 0
	n := len(s)
	for i < n {
		for i < n && isSpace(s[i]) {
			i++
		}
		if i >= n {
			break
		}
		j := i
		for j < n && !isSpace(s[j]) {
			j++
		}
		dst = append(dst, makeToken(s[i:j]))
		i = j
	}
	return dst
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'
}

func makeToken(field string) Token {
	lead, core, trail := trimPunct(field)
	prefix := ""
	if k := KeyPrefix(core); k != "" {
		prefix = k
		var l2, t2 string
		l2, core, t2 = trimPunct(core[len(k):])
		prefix += l2
		trail = t2 + trail
	}
	if core == "" {
		return Token{Text: field, Value: field, Kind: Literal}
	}
	kind := Classify(core)
	if kind == ID {
		masked, ok := MaskPartial(core)
		if !ok {
			return Token{Text: field, Value: core, Kind: Literal}
		}
		return Token{Text: lead + prefix + masked + trail, Value: core, Kind: ID}
	}
	if kind == Literal {
		if prefix == "" && lead == "" && trail == "" {
			return Token{Text: field, Value: field, Kind: Literal}
		}
		return Token{Text: field, Value: core, Kind: Literal}
	}
	if lead == "" && prefix == "" && trail == "" {
		return Token{Text: kind.Placeholder(), Value: core, Kind: kind}
	}
	return Token{Text: lead + prefix + kind.Placeholder() + trail, Value: core, Kind: kind}
}

// MaskPartial masks the variable pieces inside an identifier-like token
// while keeping its readable structure: "worker-12" → "worker-<NUM>",
// "service.go:212" → "service.go:<NUM>", "Authorize(0x0" → "Authorize(<HEX>".
// Short letter+digit words such as "x509", "sha256" or "v1" are kept
// verbatim. ok is false when nothing was masked.
func MaskPartial(s string) (string, bool) {
	var b strings.Builder
	masked := false
	for i := 0; i < len(s); {
		if !isAlnum(s[i]) {
			b.WriteByte(s[i])
			i++
			continue
		}
		j := i
		for j < len(s) && isAlnum(s[j]) {
			j++
		}
		maskRun(&b, s[i:j], &masked)
		i = j
	}
	if !masked {
		return s, false
	}
	return b.String(), true
}

func isAlnum(c byte) bool { return isDigit(c) || isAlpha(c) }

func maskRun(b *strings.Builder, run string, masked *bool) {
	digits, letters, hexOnly := 0, 0, true
	for i := 0; i < len(run); i++ {
		if isDigit(run[i]) {
			digits++
		} else {
			letters++
			if !isHex(run[i]) {
				hexOnly = false
			}
		}
	}
	switch {
	case digits == 0:
		b.WriteString(run)
		return
	case letters == 0:
		b.WriteString(NUM.Placeholder())
	case len(run) > 2 && run[0] == '0' && (run[1] == 'x' || run[1] == 'X') && allHex(run[2:]):
		b.WriteString(HEX.Placeholder())
	case hexOnly && len(run) >= 6:
		b.WriteString(HEX.Placeholder())
	case digits <= 3 && isDigit(run[len(run)-1]) && !isDigit(run[0]) && isDigitSuffix(run, digits):
		b.WriteString(run) // x509, sha256, v1, http2
		return
	default:
		for i := 0; i < len(run); {
			if !isDigit(run[i]) {
				b.WriteByte(run[i])
				i++
				continue
			}
			for i < len(run) && isDigit(run[i]) {
				i++
			}
			b.WriteString(NUM.Placeholder())
		}
	}
	*masked = true
}

func allHex(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !isHex(s[i]) {
			return false
		}
	}
	return true
}

// isDigitSuffix reports whether the last n bytes of run are its only digits.
func isDigitSuffix(run string, n int) bool {
	for i := len(run) - n; i < len(run); i++ {
		if !isDigit(run[i]) {
			return false
		}
	}
	return true
}

// trimPunct splits wrapping punctuation off a field. A trailing '.' or ':'
// that is part of a number or time (e.g. "1.5") is never stripped because the
// trailing set only removes characters at the very end.
func trimPunct(f string) (lead, core, trail string) {
	a, b := 0, len(f)
	for a < b && strings.IndexByte(leadPunct, f[a]) >= 0 {
		a++
	}
	for b > a && strings.IndexByte(trailPunct, f[b-1]) >= 0 {
		b--
	}
	return f[:a], f[a:b], f[b:]
}

// KeyPrefix returns "key=" when tok looks like key=value with an
// identifier-like key and a non-empty value, else "".
func KeyPrefix(tok string) string {
	eq := strings.IndexByte(tok, '=')
	if eq <= 0 || eq == len(tok)-1 {
		return ""
	}
	for i := 0; i < eq; i++ {
		c := tok[i]
		if !(c == '_' || c == '-' || c == '.' || isAlpha(c) || (i > 0 && isDigit(c))) {
			return ""
		}
	}
	return tok[:eq+1]
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }
func isAlpha(c byte) bool { return (c|0x20) >= 'a' && (c|0x20) <= 'z' }
func isHex(c byte) bool   { return isDigit(c) || ((c|0x20) >= 'a' && (c|0x20) <= 'f') }

var tsRe = regexp.MustCompile(`^(\d{4}[-/]\d{2}[-/]\d{2}([T_ ]?\d{2}:\d{2}(:\d{2}([.,]\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}:\d{2}([.,]\d+)?(Z|[+-]\d{2}:?\d{2})?)$`)

// Classify decides which kind of variable s is. Strings without a digit are
// always Literal, which keeps the common case fast.
func Classify(s string) Kind {
	hasDigit := false
	for i := 0; i < len(s); i++ {
		if isDigit(s[i]) {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return Literal
	}
	switch {
	case isUUID(s):
		return UUID
	case isIP(s):
		return IP
	case tsRe.MatchString(s):
		return TS
	case isHexToken(s):
		return HEX
	}
	if _, unit, ok := splitNumber(s); ok {
		switch {
		case unit == "" || unit == "%":
			return NUM
		case isDurationUnit(unit) || isCompoundDuration(s):
			return DUR
		case sizeFactor(unit) > 0:
			return SIZE
		}
	}
	return ID
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		switch i {
		case 8, 13, 18, 23:
			if s[i] != '-' {
				return false
			}
		default:
			if !isHex(s[i]) {
				return false
			}
		}
	}
	return true
}

func isIP(s string) bool {
	// IPv4 with optional :port or /cidr.
	if i := strings.IndexAny(s, ":/"); i > 0 {
		rest := s[i+1:]
		if rest == "" {
			return false
		}
		for k := 0; k < len(rest); k++ {
			if !isDigit(rest[k]) {
				return false
			}
		}
		s = s[:i]
	}
	parts := 0
	val, digits := 0, 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == '.' {
			if digits == 0 || val > 255 {
				return false
			}
			parts++
			val, digits = 0, 0
			continue
		}
		if !isDigit(s[i]) || digits == 3 {
			return false
		}
		val = val*10 + int(s[i]-'0')
		digits++
	}
	return parts == 4
}

func isHexToken(s string) bool {
	if len(s) > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
		for i := 2; i < len(s); i++ {
			if !isHex(s[i]) {
				return false
			}
		}
		return true
	}
	if len(s) < 8 {
		return false
	}
	letter := false
	for i := 0; i < len(s); i++ {
		if !isHex(s[i]) {
			return false
		}
		if !isDigit(s[i]) {
			letter = true
		}
	}
	return letter
}

// splitNumber parses a leading decimal number (sign, digits, fraction,
// exponent) and returns the number text and the remaining unit. ok is false
// if s does not start with a number or the unit is not purely alphabetic
// (or '%', or a compound duration such as "1m30s").
func splitNumber(s string) (num, unit string, ok bool) {
	i := 0
	if i < len(s) && (s[i] == '-' || s[i] == '+') {
		i++
	}
	start := i
	for i < len(s) && isDigit(s[i]) {
		i++
	}
	if i < len(s) && s[i] == '.' {
		i++
		for i < len(s) && isDigit(s[i]) {
			i++
		}
	}
	if i == start || (i == start+1 && s[start] == '.') {
		return "", "", false
	}
	if i+1 < len(s) && (s[i] == 'e' || s[i] == 'E') && (isDigit(s[i+1]) || ((s[i+1] == '-' || s[i+1] == '+') && i+2 < len(s) && isDigit(s[i+2]))) {
		j := i + 1
		if s[j] == '-' || s[j] == '+' {
			j++
		}
		for j < len(s) && isDigit(s[j]) {
			j++
		}
		i = j
	}
	num, unit = s[:i], s[i:]
	if unit == "%" || unit == "" {
		return num, unit, true
	}
	if isCompoundDuration(s) {
		return num, unit, true
	}
	for k := 0; k < len(unit); k++ {
		if !isAlpha(unit[k]) && unit[k] != 0xc2 && unit[k] != 0xb5 { // allow µ
			return "", "", false
		}
	}
	return num, unit, true
}

var durUnits = map[string]float64{
	"ns": 1e-9, "us": 1e-6, "µs": 1e-6, "ms": 1e-3, "s": 1, "sec": 1, "secs": 1,
	"m": 60, "min": 60, "mins": 60, "h": 3600, "hr": 3600, "hrs": 3600, "d": 86400,
}

func isDurationUnit(u string) bool { _, ok := durUnits[u]; return ok }

var sizeUnits = map[string]float64{
	"B": 1, "b": 1, "bytes": 1, "KB": 1e3, "kB": 1e3, "kb": 1e3, "MB": 1e6, "mb": 1e6, "GB": 1e9, "gb": 1e9, "TB": 1e12,
	"KiB": 1024, "MiB": 1 << 20, "GiB": 1 << 30, "TiB": 1 << 40,
}

func sizeFactor(u string) float64 { return sizeUnits[u] }

// isCompoundDuration matches Go-style durations with more than one unit,
// such as "1h2m3.5s" or "2m30s".
func isCompoundDuration(s string) bool {
	_, ok := parseCompound(s)
	return ok
}

func parseCompound(s string) (float64, bool) {
	total := 0.0
	parts := 0
	for len(s) > 0 {
		i := 0
		for i < len(s) && (isDigit(s[i]) || s[i] == '.') {
			i++
		}
		if i == 0 {
			return 0, false
		}
		v, ok := parseFloat(s[:i])
		if !ok {
			return 0, false
		}
		j := i
		for j < len(s) && !isDigit(s[j]) && s[j] != '.' {
			j++
		}
		f, ok := durUnits[s[i:j]]
		if !ok {
			return 0, false
		}
		total += v * f
		parts++
		s = s[j:]
	}
	return total, parts >= 2
}

// Dimension of a parsed quantity.
type Dimension uint8

const (
	Plain Dimension = iota
	Time
	Bytes
	Percent
)

func (d Dimension) String() string {
	return [...]string{"", "time", "bytes", "percent"}[d]
}

// Quantity parses a value such as "23ms", "1.5GiB", "42", "97%" into a number
// expressed in the base unit of its dimension (seconds, bytes, ...).
func Quantity(s string) (float64, Dimension, bool) {
	if s == "" {
		return 0, Plain, false
	}
	if v, ok := parseCompound(s); ok {
		return v, Time, true
	}
	num, unit, ok := splitNumber(s)
	if !ok {
		return 0, Plain, false
	}
	v, ok := parseFloat(num)
	if !ok {
		return 0, Plain, false
	}
	switch {
	case unit == "":
		return v, Plain, true
	case unit == "%":
		return v, Percent, true
	}
	if f, ok := durUnits[unit]; ok {
		return v * f, Time, true
	}
	if f := sizeFactor(unit); f > 0 {
		return v * f, Bytes, true
	}
	return 0, Plain, false
}

// parseFloat is a small allocation-free decimal parser. It accepts what
// splitNumber accepts.
func parseFloat(s string) (float64, bool) {
	if s == "" {
		return 0, false
	}
	neg := false
	i := 0
	if s[0] == '-' || s[0] == '+' {
		neg = s[0] == '-'
		i++
	}
	v := 0.0
	digits := 0
	for i < len(s) && isDigit(s[i]) {
		v = v*10 + float64(s[i]-'0')
		i++
		digits++
	}
	if i < len(s) && s[i] == '.' {
		i++
		scale := 0.1
		for i < len(s) && isDigit(s[i]) {
			v += float64(s[i]-'0') * scale
			scale /= 10
			i++
			digits++
		}
	}
	if digits == 0 {
		return 0, false
	}
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		i++
		eneg := false
		if i < len(s) && (s[i] == '-' || s[i] == '+') {
			eneg = s[i] == '-'
			i++
		}
		e := 0
		ed := 0
		for i < len(s) && isDigit(s[i]) {
			if e < 400 {
				e = e*10 + int(s[i]-'0')
			}
			i++
			ed++
		}
		if ed == 0 {
			return 0, false
		}
		for ; e > 0; e-- {
			if eneg {
				v /= 10
			} else {
				v *= 10
			}
		}
	}
	if i != len(s) {
		return 0, false
	}
	if neg {
		v = -v
	}
	return v, true
}

// IsWildcard reports whether a template token is (or ends in) a generic
// wildcard produced by clustering.
func IsWildcard(t string) bool { return strings.HasSuffix(t, "<*>") }

// HasMask reports whether a token text contains a placeholder (a typed mask
// such as "<NUM>" or the generic wildcard "<*>").
func HasMask(t string) bool {
	if strings.IndexByte(t, '<') < 0 {
		return false
	}
	if strings.Contains(t, "<*>") {
		return true
	}
	for k := TS; k < numKinds; k++ {
		if strings.Contains(t, placeholders[k]) {
			return true
		}
	}
	return false
}
