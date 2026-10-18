//go:build !(linux || darwin || freebsd || netbsd || openbsd)

package cli

import "os"

func ttyWidth(*os.File) int { return 0 }
