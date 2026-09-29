package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// /usr/bin/git is an xcrun shim on macOS. A translated DBX process can make
// that shim request Intel libraries from an ARM-only Command Line Tools install.
// Execute the selected developer tool directly so macOS chooses its native slice.
func gitExecutable() (string, error) {
	path, err := exec.LookPath("git")
	if runtime.GOOS != "darwin" || (err == nil && path != "/usr/bin/git") {
		return path, err
	}
	candidates := []string{}
	if developer := os.Getenv("DEVELOPER_DIR"); filepath.IsAbs(developer) {
		candidates = append(candidates, filepath.Join(developer, "usr/bin/git"), filepath.Join(developer, "Contents/Developer/usr/bin/git"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if developer, e := exec.CommandContext(ctx, "/usr/bin/xcode-select", "-p").Output(); e == nil {
		root := strings.TrimSpace(string(developer))
		if filepath.IsAbs(root) {
			candidates = append(candidates, filepath.Join(root, "usr/bin/git"))
		}
	}
	candidates = append(candidates, "/Library/Developer/CommandLineTools/usr/bin/git", "/Applications/Xcode.app/Contents/Developer/usr/bin/git")
	if direct := firstGitExecutable(candidates); direct != "" {
		return direct, nil
	}
	return path, err
}

func firstGitExecutable(candidates []string) string {
	for _, path := range candidates {
		if !filepath.IsAbs(path) || path == "/usr/bin/git" {
			continue
		}
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
			return path
		}
	}
	return ""
}
