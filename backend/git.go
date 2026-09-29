package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	sdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const gitOutputLimit = 256 << 10

type gitChange struct {
	Path    string `json:"path"`
	Index   string `json:"index"`
	Working string `json:"working"`
}
type gitState struct {
	State    string      `json:"state"`
	Revision string      `json:"revision"`
	Branch   string      `json:"branch"`
	Changes  []gitChange `json:"changes"`
}
type gitRequest struct {
	WorkspaceID string `json:"workspaceId"`
	Path        string `json:"path"`
	Staged      bool   `json:"staged"`
}
type gitBuffer struct {
	bytes.Buffer
	exceeded bool
}

func (b *gitBuffer) Write(data []byte) (int, error) {
	if b.Len()+len(data) > gitOutputLimit {
		b.exceeded = true
		return 0, errors.New("Git output is too large; narrow the changes and refresh")
	}
	return b.Buffer.Write(data)
}

// No shell, optional index writes, interactive prompts, external diff or textconv.
func runGit(root string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	base := []string{"--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.quotePath=false", "--git-dir=" + filepath.Join(root, ".git"), "--work-tree=" + root}
	executable, lookupErr := gitExecutable()
	if lookupErr != nil {
		return nil, errors.New("Git is not installed")
	}
	cmd := exec.CommandContext(ctx, executable, append(base, args...)...)
	cmd.Dir = root
	for _, v := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(v), "GIT_") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0", "GIT_NO_LAZY_FETCH=1", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "LC_ALL=C")
	var out, stderr gitBuffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("Git request timed out")
		}
		if errors.Is(err, exec.ErrNotFound) {
			return nil, errors.New("Git is not installed")
		}
		if out.exceeded {
			return nil, errors.New("Git output exceeds 256 KiB. Reduce the number of untracked files or add generated files to .gitignore")
		}
		operation := "command"
		if len(args) > 0 {
			operation = args[0]
		}
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			return nil, fmt.Errorf("Cannot start Git (%s): %s", operation, safeGitError(root, err.Error()))
		}
		detail := safeGitError(root, stderr.String())
		if detail == "" {
			detail = "Git returned no diagnostic text"
		}
		return nil, fmt.Errorf("Git %s failed (exit %d): %s", operation, exit.ExitCode(), detail)
	}
	return out.Bytes(), nil
}

// Show actionable process errors without logging repository paths or remote credentials.
func safeGitError(root, detail string) string {
	detail = strings.ReplaceAll(detail, root, "<workspace>")
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		detail = strings.ReplaceAll(detail, home, "~")
	}
	detail = regexp.MustCompile(`(?i)(?:https?|ssh|git)://[^\s]+`).ReplaceAllString(detail, "<remote>")
	detail = regexp.MustCompile(`[\w.+-]+@[^\s]+`).ReplaceAllString(detail, "<remote>")
	detail = strings.Map(func(r rune) rune {
		if r < 32 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, detail)
	detail = strings.TrimSpace(detail)
	if len(detail) > 1000 {
		detail = string([]rune(detail)[:min(500, len([]rune(detail)))]) + "…"
	}
	return detail
}

func gitRootState(scope workspaceScope) string {
	if scope.file != "" {
		return "folderRequired"
	}
	info, err := os.Lstat(filepath.Join(scope.root, ".git"))
	if os.IsNotExist(err) {
		return "notRepository"
	}
	if err != nil {
		return "unavailable"
	}
	// Worktrees and linked metadata may grant access outside the opened folder.
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "linkedRepository"
	}
	return "ready"
}

func (p *plugin) gitStatus(params json.RawMessage) (any, *sdk.PluginError) {
	gitWriteMu.Lock()
	defer gitWriteMu.Unlock()
	var req gitRequest
	if json.Unmarshal(params, &req) != nil {
		return nil, invalidRequest("Invalid Git request")
	}
	scope, e := p.rootFor(req.WorkspaceID)
	if e != nil {
		return nil, e
	}
	result := gitState{State: gitRootState(scope), Changes: []gitChange{}}
	if result.State != "ready" {
		return result, nil
	}
	if _, err := gitExecutable(); err != nil {
		result.State = "missingGit"
		return result, nil
	}
	raw, err := runGit(scope.root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--no-renames")
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	result.Changes = parseGitChanges(raw)
	branch, err := runGit(scope.root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		branch, err = runGit(scope.root, "rev-parse", "--short", "HEAD")
		if err != nil {
			return nil, invalidRequest("Cannot read Git HEAD")
		}
		result.Branch = "HEAD · " + strings.TrimSpace(string(branch))
	} else {
		result.Branch = strings.TrimSpace(string(branch))
	}
	result.Revision, err = gitRevision(scope.root)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	return result, nil
}
func parseGitChanges(raw []byte) []gitChange {
	changes := []gitChange{}
	for _, line := range bytes.Split(raw, []byte{0}) {
		if len(line) >= 4 && line[2] == ' ' {
			changes = append(changes, gitChange{Path: string(line[3:]), Index: string(line[0]), Working: string(line[1])})
		}
	}
	return changes
}

// Check each existing component, including deleted-file parents. Never follow symlinks.
func validateGitPath(root, relative string) error {
	clean := filepath.Clean(filepath.FromSlash(relative))
	if relative == "" || strings.ContainsRune(relative, 0) || filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return errors.New("Invalid Git file path")
	}
	current := root
	for _, part := range strings.Split(clean, string(filepath.Separator)) {
		if strings.EqualFold(part, ".git") {
			return errors.New("Git metadata cannot be previewed")
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return errors.New("Cannot inspect Git file")
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("Symbolic links cannot be previewed")
		}
	}
	return nil
}
func (p *plugin) gitDiff(params json.RawMessage) (any, *sdk.PluginError) {
	var req gitRequest
	if json.Unmarshal(params, &req) != nil {
		return nil, invalidRequest("Invalid Git diff request")
	}
	scope, e := p.rootFor(req.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if gitRootState(scope) != "ready" {
		return nil, invalidRequest("Open a repository root with local Git metadata")
	}
	if err := validateGitPath(scope.root, req.Path); err != nil {
		return nil, invalidRequest(err.Error())
	}
	raw, err := runGit(scope.root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--no-renames", "--", req.Path)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	var selected *gitChange
	for _, change := range parseGitChanges(raw) {
		if change.Path == req.Path {
			c := change
			selected = &c
			break
		}
	}
	if selected == nil {
		return map[string]string{"diff": ""}, nil
	}
	var diff []byte
	if selected.Index == "?" {
		file := filepath.Join(scope.root, filepath.FromSlash(req.Path))
		info, err := os.Stat(file)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
			return nil, invalidRequest("New-file preview supports regular text files up to 64 KiB")
		}
		content, err := os.ReadFile(file)
		if err != nil {
			return nil, invalidRequest("Cannot read new file")
		}
		if !utf8.Valid(content) || bytes.ContainsRune(content, 0) {
			return nil, invalidRequest("Binary file preview is unavailable")
		}
		diff = []byte("+++ " + req.Path + "\n+" + strings.ReplaceAll(string(content), "\n", "\n+"))
	} else {
		args := []string{"diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=all"}
		if req.Staged {
			args = append(args, "--cached")
		}
		args = append(args, "--", req.Path)
		diff, err = runGit(scope.root, args...)
		if err != nil {
			return nil, invalidRequest(err.Error())
		}
	}
	return map[string]string{"diff": string(diff)}, nil
}

var gitWriteMu sync.Mutex

func gitRevision(root string) (string, error) {
	h := sha256.New()
	for _, name := range []string{"HEAD", "index"} {
		file := filepath.Join(root, ".git", name)
		info, err := os.Lstat(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() {
			return "", errors.New("Unsupported Git metadata")
		}
		f, err := os.Open(file)
		if err != nil {
			return "", errors.New("Cannot read Git metadata")
		}
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			return "", errors.New("Cannot read Git metadata")
		}
	}
	if head, err := runGit(root, "rev-parse", "--verify", "HEAD"); err == nil {
		h.Write(head)
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func runGitWrite(root, message string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	base := []string{"--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false", "--git-dir=" + filepath.Join(root, ".git"), "--work-tree=" + root}
	executable, lookupErr := gitExecutable()
	if lookupErr != nil {
		return errors.New("Git is not installed")
	}
	cmd := exec.CommandContext(ctx, executable, append(base, args...)...)
	cmd.Dir = root
	for _, v := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(v), "GIT_") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0", "GIT_NO_LAZY_FETCH=1", "GIT_EDITOR=true", "LC_ALL=C")
	cmd.Stdin = strings.NewReader(message)
	var stderr gitBuffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return errors.New("Git timed out. Refresh status before retrying")
		}
		detail := stderr.String()
		if strings.Contains(detail, "identity unknown") || strings.Contains(detail, "unable to auto-detect") {
			return errors.New("Configure Git user.name and user.email before committing")
		}
		if strings.Contains(detail, "index.lock") {
			return errors.New("Git index is locked by another operation. Retry after it finishes")
		}
		if strings.Contains(detail, "sign") || strings.Contains(detail, "gpg") {
			return errors.New("Commit signing failed. Check your Git signing configuration")
		}
		return errors.New("Git operation failed. Check repository permissions, hooks, and Git configuration; refresh before retrying")
	}
	return nil
}

func (p *plugin) gitMutate(params json.RawMessage) (any, *sdk.PluginError) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		Action      string `json:"action"`
		Path        string `json:"path"`
		Message     string `json:"message"`
		Revision    string `json:"revision"`
	}
	if json.Unmarshal(params, &req) != nil {
		return nil, invalidRequest("Invalid Git action")
	}
	gitWriteMu.Lock()
	defer gitWriteMu.Unlock()
	scope, e := p.rootFor(req.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if gitRootState(scope) != "ready" {
		return nil, invalidRequest("Open a repository root with local Git metadata")
	}

	// Linked metadata must not redirect index/object writes beyond this workspace.
	for _, name := range []string{"objects", "refs", "logs", "index", "HEAD", "config"} {
		info, err := os.Lstat(filepath.Join(scope.root, ".git", name))
		if err != nil && !os.IsNotExist(err) {
			return nil, invalidRequest("Cannot inspect Git metadata")
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return nil, invalidRequest("Linked Git metadata cannot be modified")
		}
	}
	if _, err := os.Lstat(filepath.Join(scope.root, ".git", "commondir")); !os.IsNotExist(err) {
		return nil, invalidRequest("Shared Git metadata cannot be modified")
	}
	revision, err := gitRevision(scope.root)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	if req.Revision == "" || req.Revision != revision {
		return nil, invalidRequest("Git changed outside the editor. Refresh and review before retrying")
	}
	for _, marker := range []string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"} {
		if _, err := os.Lstat(filepath.Join(scope.root, ".git", marker)); !os.IsNotExist(err) {
			return nil, invalidRequest("Finish the current merge, rebase, or cherry-pick in Git before using these actions")
		}
	}
	raw, err := runGit(scope.root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--no-renames")
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	changes := parseGitChanges(raw)
	for _, c := range changes {
		if c.Index == "U" || c.Working == "U" || c.Index+c.Working == "AA" || c.Index+c.Working == "DD" {
			return nil, invalidRequest("Resolve Git conflicts before staging or committing")
		}
	}
	var args []string
	switch req.Action {
	case "stage", "stageAll", "unstage", "unstageAll":
		staging := req.Action == "stage" || req.Action == "stageAll"
		all := req.Action == "stageAll" || req.Action == "unstageAll"
		paths := []string{}
		for _, c := range changes {
			eligible := c.Index != " " && c.Index != "?"
			if staging {
				eligible = c.Working != " "
			}
			if eligible && (all || c.Path == req.Path) {
				if err := validateGitPath(scope.root, c.Path); err != nil {
					return nil, invalidRequest(err.Error())
				}
				paths = append(paths, c.Path)
			}
		}
		if len(paths) == 0 {
			return nil, invalidRequest("No matching changes. Refresh the Git list")
		}
		// A bounded batch avoids command-line limits and partial multi-command operations.
		if len(strings.Join(paths, "")) > 16000 {
			return nil, invalidRequest("Too many paths. Stage or unstage smaller groups")
		}
		if staging {
			args = []string{"add", "-A", "--"}
		} else if _, err := runGit(scope.root, "rev-parse", "--verify", "HEAD"); err == nil {
			args = []string{"reset", "-q", "HEAD", "--"}
		} else {
			args = []string{"rm", "--cached", "-f", "--ignore-unmatch", "--"}
		}
		args = append(args, paths...)
	case "commit", "commitPush":
		if strings.TrimSpace(req.Message) == "" || len(req.Message) > 16000 || strings.ContainsRune(req.Message, 0) {
			return nil, invalidRequest("Enter a commit message (up to 16000 bytes)")
		}
		staged := false
		for _, c := range changes {
			if c.Index != " " && c.Index != "?" {
				staged = true
			}
		}
		if !staged {
			return nil, invalidRequest("Stage changes before committing")
		}
		args = []string{"commit", "--file=-"}
	case "createBranch":
		if len(changes) != 0 {
			return nil, invalidRequest("Commit or stash disk changes before creating a branch")
		}
		if req.Path == "" || strings.HasPrefix(req.Path, "-") || strings.HasPrefix(req.Path, "@") || strings.ContainsAny(req.Path, "\\\n\r\x00") {
			return nil, invalidRequest("Enter a valid new branch name")
		}
		if _, err := runGit(scope.root, "check-ref-format", "refs/heads/"+req.Path); err != nil {
			return nil, invalidRequest("Invalid branch name")
		}
		if _, err := runGit(scope.root, "rev-parse", "--verify", "HEAD"); err != nil {
			return nil, invalidRequest("Create the first commit before branching")
		}
		if _, err := runGit(scope.root, "show-ref", "--verify", "refs/heads/"+req.Path); err == nil {
			return nil, invalidRequest("Branch already exists; select it from the list")
		}
		args = []string{"switch", "--no-guess", "-c", req.Path}
	case "switch":
		if len(changes) != 0 {
			return nil, invalidRequest("Commit or stash disk changes before switching branches")
		}
		if req.Path == "" || strings.HasPrefix(req.Path, "-") {
			return nil, invalidRequest("Select an existing local branch")
		}
		if _, err := runGit(scope.root, "show-ref", "--verify", "refs/heads/"+req.Path); err != nil {
			return nil, invalidRequest("Local branch no longer exists")
		}
		args = []string{"switch", "--no-guess", req.Path}
	case "fetch", "pull", "push", "sync":
		if (req.Action == "pull" || req.Action == "sync") && len(changes) != 0 {
			return nil, invalidRequest("Commit or stash disk changes before pulling")
		}
		if err := gitRemoteAction(scope.root, req.Action); err != nil {
			return nil, invalidRequest(err.Error())
		}
		return map[string]bool{"success": true}, nil
	default:
		return nil, invalidRequest("Unsupported Git action")
	}
	if err := runGitWrite(scope.root, req.Message, args...); err != nil {
		return nil, invalidRequest(err.Error())
	}
	if req.Action == "commitPush" {
		if err := gitRemoteAction(scope.root, "push"); err != nil {
			return nil, invalidRequest("Committed locally, but push failed: " + err.Error())
		}
	}
	return map[string]bool{"success": true}, nil
}
