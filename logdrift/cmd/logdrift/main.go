// Command logdrift diffs the behavior of log files.
package main

import (
	"os"

	"github.com/jerretsmith1995-max/jerretsmith1995-max/logdrift/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], os.Stdout, os.Stderr))
}
