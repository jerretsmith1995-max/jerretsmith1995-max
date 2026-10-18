BIN     := bin/logdrift
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/cli.Version=$(VERSION)

.PHONY: build test bench fuzz demo demo-html examples clean

build:
	go build -trimpath -ldflags '$(LDFLAGS)' -o $(BIN) ./cmd/logdrift

test:
	go vet ./...
	go test -race ./...

bench:
	go test -run '^$$' -bench . -benchmem ./...

fuzz:
	go test ./internal/token -run '^$$' -fuzz FuzzTokenize -fuzztime 30s

demo: build
	cd examples && ../$(BIN) good-1.log good-2.log bad.log --color always || true
	cd examples && ../$(BIN) ci-pass-1.log ci-pass-2.log ci-fail.log --color always || true

demo-html: build
	cd examples && ../$(BIN) good-1.log good-2.log bad.log -f html -o report.html || true
	@echo "wrote examples/report.html"

# Regenerate the demo logs (deterministic).
examples:
	go run ./examples/gen -scenario good -seed 1 > examples/good-1.log
	go run ./examples/gen -scenario good -seed 2 > examples/good-2.log
	go run ./examples/gen -scenario bad -seed 3 > examples/bad.log
	go run ./examples/gen -scenario ci-pass -seed 1 > examples/ci-pass-1.log
	go run ./examples/gen -scenario ci-pass -seed 2 > examples/ci-pass-2.log
	go run ./examples/gen -scenario ci-fail -seed 3 > examples/ci-fail.log

clean:
	rm -rf bin examples/report.html
