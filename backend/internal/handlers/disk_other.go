//go:build !linux
// +build !linux

package handlers

// getDiskStats is a no-op stub on non-Linux platforms (Windows dev environment).
// In production the backend always runs on Linux inside Docker.
func getDiskStats(_ string) (total, free uint64) {
	return 0, 0
}
