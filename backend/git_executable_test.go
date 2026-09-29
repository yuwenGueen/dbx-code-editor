package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestGitExecutableCandidates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX executable permission bits are not supported on Windows; this helper is used only on macOS")
	}
	root := t.TempDir()
	nonexec := filepath.Join(root, "not-executable")
	native := filepath.Join(root, "git")
	os.WriteFile(nonexec, []byte("not executable"), 0600)
	os.WriteFile(native, []byte("fixture"), 0700)
	got := firstGitExecutable([]string{"git", "/usr/bin/git", root, nonexec, filepath.Join(root, "missing"), native})
	if got != native {
		t.Fatalf("wanted executable developer Git, got %q", got)
	}
}

func TestMacGitBypassesXcrun(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS only")
	}
	direct := "/Library/Developer/CommandLineTools/usr/bin/git"
	if _, err := os.Stat(direct); err != nil {
		t.Skip("Command Line Tools not installed")
	}
	t.Setenv("PATH", "/usr/bin:/bin")
	path, err := gitExecutable()
	if err != nil || path == "/usr/bin/git" {
		t.Fatalf("xcrun shim not bypassed: %q %v", path, err)
	}
	root, _, _ := gitFixture(t)
	if _, err := runGit(root, "status", "--porcelain"); err != nil {
		t.Fatal(err)
	}
}
