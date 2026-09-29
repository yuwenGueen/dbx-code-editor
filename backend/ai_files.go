package main

import (
	"encoding/json"
	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// AI writes are explicit reviewed single-file operations, never shell commands.
func (p *plugin) aiWrite(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var r struct {
		WorkspaceID      string `json:"workspaceId"`
		Path             string `json:"path"`
		Content          string `json:"content"`
		ExpectedRevision string `json:"expectedRevision"`
		Encoding         string `json:"encoding"`
		Mode             string `json:"mode"`
	}
	if json.Unmarshal(params, &r) != nil {
		return nil, invalidRequest("Invalid AI file request")
	}
	scope, e := p.rootFor(r.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if scope.file != "" {
		return nil, invalidRequest("Open a project folder first")
	}
	if r.Mode != "create" && r.Mode != "update" && r.Mode != "undoCreate" {
		return nil, invalidRequest("Invalid AI file operation")
	}
	if len(r.Content) > 128*1024 || !utf8.ValidString(r.Content) || strings.ContainsRune(r.Content, 0) {
		return nil, invalidRequest("Invalid or oversized AI content")
	}
	if r.Path == "" || strings.ContainsAny(r.Path, "\\:\x00") || strings.HasPrefix(r.Path, "/") {
		return nil, invalidRequest("Invalid project path")
	}
	parts := strings.Split(r.Path, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.EqualFold(part, ".git") {
			return nil, invalidRequest("Invalid project path")
		}
	}
	target := scope.root
	for i, part := range parts {
		target = filepath.Join(target, part)
		info, err := os.Lstat(target)
		if os.IsNotExist(err) && r.Mode == "create" && i < len(parts)-1 {
			if err = os.Mkdir(target, 0755); err != nil {
				return nil, internalError(err)
			}
			info, err = os.Lstat(target)
		}
		if os.IsNotExist(err) && i == len(parts)-1 && r.Mode == "create" {
			break
		}
		if err != nil {
			return nil, internalError(err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, invalidRequest("AI cannot modify symbolic links")
		}
		if i < len(parts)-1 && !info.IsDir() {
			return nil, invalidRequest("Parent is not a folder")
		}
	}
	if r.Mode == "create" {
		return p.create(createRequest{WorkspaceID: r.WorkspaceID, Path: r.Path, Kind: "file", Content: r.Content})
	}
	if r.Mode == "update" {
		return p.save(saveRequest{WorkspaceID: r.WorkspaceID, Path: r.Path, Content: r.Content, ExpectedRevision: r.ExpectedRevision, Encoding: r.Encoding})
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil, internalError(err)
	}
	if !info.Mode().IsRegular() || info.Size() > 128*1024 || r.ExpectedRevision == "" {
		return nil, invalidRequest("Cannot undo this file")
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, internalError(err)
	}
	if revision(data) != r.ExpectedRevision {
		return nil, invalidRequest("File changed after AI application; undo refused")
	}
	if err = os.Remove(target); err != nil {
		return nil, internalError(err)
	}
	return map[string]bool{"removed": true}, nil
}
