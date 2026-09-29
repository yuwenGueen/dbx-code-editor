package main

import (
	"encoding/json"
	"errors"
	sdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"strings"
)

// Explicit upstream and refspec: never force, push unrelated branches or recurse into submodules.
func gitRemoteAction(root, action string) error {
	branch, err := runGit(root, "symbolic-ref", "--quiet", "HEAD")
	if err != nil {
		return errors.New("Select a local branch before remote operations")
	}
	upstream, err := runGit(root, "for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", strings.TrimSpace(string(branch)))
	if err != nil {
		return err
	}
	parts := strings.Split(strings.TrimSpace(string(upstream)), "\x00")
	if len(parts) != 2 || parts[0] == "" || strings.HasPrefix(parts[0], "-") || !strings.HasPrefix(parts[1], "refs/heads/") {
		return errors.New("Configure an upstream tracking branch in Git first")
	}
	remote, ref := parts[0], parts[1]
	if action == "fetch" || action == "pull" || action == "sync" {
		if err := runGitWrite(root, "", "-c", "protocol.ext.allow=never", "fetch", "--no-recurse-submodules", "--no-tags", "--", remote, ref); err != nil {
			return errors.New("Fetch failed. Check network and existing Git credentials; no interactive login is available")
		}
	}
	if action == "pull" || action == "sync" {
		if err := runGitWrite(root, "", "merge", "--ff-only", "FETCH_HEAD"); err != nil {
			return errors.New("Fast-forward pull failed. Resolve diverged branches in Git; no push was attempted")
		}
	}
	if action == "push" || action == "sync" {
		if err := runGitWrite(root, "", "-c", "protocol.ext.allow=never", "push", "--no-follow-tags", "--recurse-submodules=no", "--", remote, "HEAD:"+ref); err != nil {
			return errors.New("Push failed. Local commits are preserved; check credentials and remote branch status before retrying")
		}
	}
	return nil
}

func (p *plugin) gitInfo(params json.RawMessage) (any, *sdk.PluginError) {
	var req gitRequest
	if json.Unmarshal(params, &req) != nil {
		return nil, invalidRequest("Invalid Git request")
	}
	gitWriteMu.Lock()
	defer gitWriteMu.Unlock()
	scope, e := p.rootFor(req.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if gitRootState(scope) != "ready" {
		return nil, invalidRequest("Open a repository root")
	}
	branches, err := runGit(scope.root, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	history := []map[string]string{}
	if _, err := runGit(scope.root, "rev-parse", "--verify", "HEAD"); err == nil {
		raw, err := runGit(scope.root, "log", "-30", "--format=%h%x00%s%x00%as", "--no-show-signature")
		if err != nil {
			return nil, invalidRequest(err.Error())
		}
		for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
			parts := strings.Split(line, "\x00")
			if len(parts) == 3 {
				history = append(history, map[string]string{"hash": parts[0], "subject": parts[1], "date": parts[2]})
			}
		}
	}
	names := []string{}
	for _, name := range strings.Split(strings.TrimSpace(string(branches)), "\n") {
		if name != "" {
			names = append(names, name)
		}
	}
	return map[string]any{"branches": names, "history": history}, nil
}
