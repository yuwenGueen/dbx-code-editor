package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitFixture(t *testing.T) (string, *plugin, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git unavailable")
	}
	root := t.TempDir()
	gitTestCommand(t, root, "init", "-b", "main")
	gitTestCommand(t, root, "config", "user.name", "Test")
	gitTestCommand(t, root, "config", "user.email", "test@example.invalid")
	p, id := testWorkspace(t, root)
	return root, p, id
}
func gitTestCommand(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	if err := cmd.Run(); err != nil {
		t.Fatalf("fixture Git command failed: %v", err)
	}
}
func gitParams(id, path string, staged bool) json.RawMessage {
	b, _ := json.Marshal(gitRequest{WorkspaceID: id, Path: path, Staged: staged})
	return b
}
func TestGitStatusAndSeparateDiffs(t *testing.T) {
	root, p, id := gitFixture(t)
	name := "[note] space.txt"
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("base\n")
	gitTestCommand(t, root, "add", "--", name)
	gitTestCommand(t, root, "commit", "-m", "fixture")
	write("staged\n")
	gitTestCommand(t, root, "add", "--", name)
	write("working\n")
	if err := os.WriteFile(filepath.Join(root, "new 文件.txt"), []byte("new\n"), 0600); err != nil {
		t.Fatal(err)
	}
	result, e := p.gitStatus(gitParams(id, "", false))
	if e != nil {
		t.Fatal(e.Message)
	}
	state := result.(gitState)
	if state.Branch != "main" || len(state.Changes) != 2 {
		t.Fatal("unexpected branch or changes")
	}
	for _, staged := range []bool{false, true} {
		result, e := p.gitDiff(gitParams(id, name, staged))
		if e != nil {
			t.Fatal(e.Message)
		}
		diff := result.(map[string]string)["diff"]
		if staged && (!strings.Contains(diff, "+staged") || strings.Contains(diff, "+working")) {
			t.Fatal("staged diff includes wrong revision")
		}
		if !staged && !strings.Contains(diff, "+working") {
			t.Fatal("working diff missing")
		}
	}
	result, e = p.gitDiff(gitParams(id, "new 文件.txt", false))
	if e != nil || !strings.Contains(result.(map[string]string)["diff"], "+new") {
		t.Fatal("new file preview failed")
	}
	if err := os.Remove(filepath.Join(root, name)); err != nil {
		t.Fatal(err)
	}
	if _, e := p.gitDiff(gitParams(id, name, false)); e != nil {
		t.Fatal("deleted file should be diffable")
	}
}
func TestGitEmptyRepositoryAndBoundaries(t *testing.T) {
	root, p, id := gitFixture(t)
	result, e := p.gitStatus(gitParams(id, "", false))
	if e != nil || result.(gitState).Branch != "main" {
		t.Fatal("unborn branch failed")
	}
	for _, path := range []string{"../outside", ".git/config", root, ""} {
		if _, e := p.gitDiff(gitParams(id, path, false)); e == nil {
			t.Fatal("unsafe path accepted")
		}
	}
	if _, e := p.gitStatus(gitParams("unknown", "", false)); e == nil {
		t.Fatal("unknown workspace accepted")
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err == nil {
		if err := validateGitPath(root, "escape/deleted.txt"); err == nil {
			t.Fatal("symlink parent accepted")
		}
	}
	if gitRootState(workspaceScope{root: root, file: filepath.Join(root, "only.txt")}) != "folderRequired" {
		t.Fatal("single-file grant expanded")
	}
	child := filepath.Join(root, "child")
	os.Mkdir(child, 0700)
	if gitRootState(workspaceScope{root: child}) != "notRepository" {
		t.Fatal("ancestor scope expanded")
	}
	linked := t.TempDir()
	os.WriteFile(filepath.Join(linked, ".git"), []byte("gitdir: "+filepath.Join(root, ".git")), 0600)
	if gitRootState(workspaceScope{root: linked}) != "linkedRepository" {
		t.Fatal("linked metadata accepted")
	}
}
func TestGitDoesNotRunExternalDiff(t *testing.T) {
	root, p, id := gitFixture(t)
	file := filepath.Join(root, "note.txt")
	os.WriteFile(file, []byte("before\n"), 0600)
	gitTestCommand(t, root, "add", ".")
	gitTestCommand(t, root, "commit", "-m", "fixture")
	gitTestCommand(t, root, "config", "diff.external", "not-a-real-executable")
	os.WriteFile(file, []byte("after\n"), 0600)
	if _, e := p.gitDiff(gitParams(id, "note.txt", false)); e != nil {
		t.Fatal("external diff was not suppressed")
	}
}
func TestGitOutputBounded(t *testing.T) {
	var b gitBuffer
	if _, err := b.Write(make([]byte, gitOutputLimit+1)); err == nil || b.Len() != 0 {
		t.Fatal("output limit not enforced")
	}
}

func TestGitStatusPreservesNewlinesInNames(t *testing.T) {
	changes := parseGitChanges([]byte("?? new\nfile.txt\x00 M [file].txt\x00"))
	if len(changes) != 2 || changes[0].Path != "new\nfile.txt" || changes[1].Path != "[file].txt" {
		t.Fatal("NUL-delimited paths were not preserved")
	}
}

func gitActionParams(t *testing.T, p *plugin, id, action, path, message string) json.RawMessage {
	t.Helper()
	state, e := p.gitStatus(gitParams(id, "", false))
	if e != nil {
		t.Fatal(e.Message)
	}
	raw, _ := json.Marshal(map[string]string{"workspaceId": id, "action": action, "path": path, "message": message, "revision": state.(gitState).Revision})
	return raw
}
func TestGitStageUnstageAndCommit(t *testing.T) {
	root, p, id := gitFixture(t)
	path := "note.txt"
	write := func(s string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, path), []byte(s), 0600); err != nil {
			t.Fatal(err)
		}
	}
	action := func(name, path, message string) {
		t.Helper()
		if _, e := p.gitMutate(gitActionParams(t, p, id, name, path, message)); e != nil {
			t.Fatal(e.Message)
		}
	}
	write("initial\n")
	action("stage", path, "")
	action("unstage", path, "")
	if _, err := os.Stat(filepath.Join(root, path)); err != nil {
		t.Fatal("unstage deleted file")
	}
	action("stageAll", "", "")
	action("commit", "", "Add initial note\n\nCreate a note for the temporary repository.")
	write("staged\n")
	action("stage", path, "")
	write("working\n")
	action("commit", "", "Update note\n\nRecord the staged revision only.")
	head, err := runGit(root, "show", "HEAD:note.txt")
	if err != nil || string(head) != "staged\n" {
		t.Fatal("commit did not use staged contents")
	}
	disk, _ := os.ReadFile(filepath.Join(root, path))
	if string(disk) != "working\n" {
		t.Fatal("commit overwrote working copy")
	}
	action("stageAll", "", "")
	action("unstageAll", "", "")
	state, e := p.gitStatus(gitParams(id, "", false))
	if e != nil || state.(gitState).Changes[0].Index != " " {
		t.Fatal("unstage failed")
	}
}
func TestGitActionsRejectStaleEmptyAndOutsideRequests(t *testing.T) {
	root, p, id := gitFixture(t)
	os.WriteFile(filepath.Join(root, "note.txt"), []byte("initial\n"), 0600)
	stale := gitActionParams(t, p, id, "stage", "note.txt", "")
	gitTestCommand(t, root, "add", "note.txt")
	if _, e := p.gitMutate(stale); e == nil {
		t.Fatal("stale index accepted")
	}
	for _, action := range []string{"stage", "unstage"} {
		if _, e := p.gitMutate(gitActionParams(t, p, id, action, "../outside", "")); e == nil {
			t.Fatal("outside path accepted")
		}
	}
	if _, e := p.gitMutate(gitActionParams(t, p, id, "commit", "", "  ")); e == nil {
		t.Fatal("empty message accepted")
	}
	if _, e := p.gitMutate(gitActionParams(t, p, id, "push", "", "")); e == nil {
		t.Fatal("unknown action accepted")
	}
	os.WriteFile(filepath.Join(root, ".git", "MERGE_HEAD"), []byte("pending"), 0600)
	if _, e := p.gitMutate(gitActionParams(t, p, id, "commit", "", "Do not commit merge")); e == nil {
		t.Fatal("merge operation accepted")
	}
}
func TestGitDeletionStagingAndHookFailure(t *testing.T) {
	root, p, id := gitFixture(t)
	file := filepath.Join(root, "note.txt")
	os.WriteFile(file, []byte("initial\n"), 0600)
	gitTestCommand(t, root, "add", ".")
	gitTestCommand(t, root, "commit", "-m", "fixture")
	os.Remove(file)
	if _, e := p.gitMutate(gitActionParams(t, p, id, "stage", "note.txt", "")); e != nil {
		t.Fatal(e.Message)
	}
	hook := filepath.Join(root, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	before, _ := runGit(root, "rev-parse", "HEAD")
	if _, e := p.gitMutate(gitActionParams(t, p, id, "commit", "", "Delete note")); e == nil {
		t.Fatal("failing hook was bypassed")
	}
	after, _ := runGit(root, "rev-parse", "HEAD")
	if string(before) != string(after) {
		t.Fatal("failed commit moved HEAD")
	}
}

func TestGitRemoteAndBranchWorkflow(t *testing.T) {
	root, p, id := gitFixture(t)
	os.WriteFile(filepath.Join(root, "note.txt"), []byte("base\n"), 0600)
	gitTestCommand(t, root, "add", ".")
	gitTestCommand(t, root, "commit", "-m", "initial")
	remote := t.TempDir()
	gitTestCommand(t, remote, "init", "--bare")
	gitTestCommand(t, root, "remote", "add", "origin", remote)
	gitTestCommand(t, root, "push", "-u", "origin", "main")
	action := func(name, path string) {
		t.Helper()
		if _, e := p.gitMutate(gitActionParams(t, p, id, name, path, "")); e != nil {
			t.Fatal(name, e.Message)
		}
	}
	action("fetch", "")
	action("pull", "")
	action("push", "")
	action("sync", "")
	gitTestCommand(t, root, "branch", "feature")
	action("switch", "feature")
	action("switch", "main")
	result, e := p.gitInfo(gitParams(id, "", false))
	if e != nil {
		t.Fatal(e.Message)
	}
	info := result.(map[string]any)
	if len(info["branches"].([]string)) != 2 || len(info["history"].([]map[string]string)) != 1 {
		t.Fatal("missing branch/history")
	}
	os.WriteFile(filepath.Join(root, "note.txt"), []byte("dirty\n"), 0600)
	for _, name := range []string{"pull", "sync", "switch"} {
		if _, e := p.gitMutate(gitActionParams(t, p, id, name, "feature", "")); e == nil {
			t.Fatal("dirty worktree accepted", name)
		}
	}
	gitTestCommand(t, root, "add", ".")
	if _, e := p.gitMutate(gitActionParams(t, p, id, "commitPush", "", "second")); e != nil {
		t.Fatal(e.Message)
	}
	localHead, _ := runGit(root, "rev-parse", "HEAD")
	cmd := exec.Command("git", "--git-dir="+remote, "rev-parse", "refs/heads/main")
	remoteHead, err := cmd.Output()
	if err != nil || string(localHead) != string(remoteHead) {
		t.Fatal("commit not pushed")
	}
}

func TestGitErrorsKeepCauseAndRedactRemote(t *testing.T) {
	root, p, id := gitFixture(t)
	// Invalid repository-local config produces the same generic failure as startup errors used to.
	os.WriteFile(filepath.Join(root, ".git", "config"), []byte("[broken\n"), 0600)
	_, e := p.gitStatus(gitParams(id, "", false))
	if e == nil || !strings.Contains(e.Message, "exit 128") || !strings.Contains(e.Message, "config") || strings.Contains(e.Message, root) {
		t.Fatalf("expected actionable sanitized Git diagnostic: %v", e)
	}
	cleaned := safeGitError(root, "fatal https://user:secret@example.invalid/repo git@example.invalid:repo "+root)
	if strings.Contains(cleaned, "secret") || strings.Contains(cleaned, "example.invalid") || strings.Contains(cleaned, root) {
		t.Fatal("diagnostic leaked context")
	}
}

func TestCreateBranch(t *testing.T) {
	root, p, id := gitFixture(t)
	os.WriteFile(filepath.Join(root, "note"), []byte("base"), 0600)
	gitTestCommand(t, root, "add", ".")
	gitTestCommand(t, root, "commit", "-m", "base")
	for _, name := range []string{"-force", "bad name", "../escape", "main", "@{-1}"} {
		if _, e := p.gitMutate(gitActionParams(t, p, id, "createBranch", name, "")); e == nil {
			t.Fatalf("accepted invalid or duplicate branch %q", name)
		}
	}
	before, _ := runGit(root, "rev-parse", "HEAD")
	if _, e := p.gitMutate(gitActionParams(t, p, id, "createBranch", "feature/test", "")); e != nil {
		t.Fatal(e.Message)
	}
	branch, _ := runGit(root, "symbolic-ref", "--short", "HEAD")
	after, _ := runGit(root, "rev-parse", "HEAD")
	if strings.TrimSpace(string(branch)) != "feature/test" || string(before) != string(after) {
		t.Fatal("new branch does not point at current commit")
	}
	os.WriteFile(filepath.Join(root, "note"), []byte("dirty"), 0600)
	if _, e := p.gitMutate(gitActionParams(t, p, id, "createBranch", "feature/dirty", "")); e == nil {
		t.Fatal("dirty worktree accepted")
	}
}
