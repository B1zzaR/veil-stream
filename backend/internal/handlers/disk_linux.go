//go:build linux
// +build linux

package handlers

import "syscall"

// getDiskStats returns total and free bytes for the filesystem at path.
func getDiskStats(path string) (total, free uint64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0
	}
	return stat.Blocks * uint64(stat.Bsize), stat.Bavail * uint64(stat.Bsize)
}
