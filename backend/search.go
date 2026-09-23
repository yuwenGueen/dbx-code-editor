package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const maxIndexedFiles = 12000
const maxSearchMatches = 500

var stoppedWalking = errors.New("workspace walk stopped")

var generatedFolders = map[string]bool{
	"node_modules": true, ".next": true, ".cache": true, "dist": true,
	"build": true, "coverage": true, "vendor": true, ".venv": true, "target": true,
}

type searchRequest struct {
	WorkspaceID   string `json:"workspaceId"`
	Query         string `json:"query"`
	CaseSensitive bool   `json:"caseSensitive"`
	IncludeBuild  bool   `json:"includeBuild"`
}

type searchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

// walkWorkspaceFiles never follows links, including links that point back inside the workspace.
func walkWorkspaceFiles(scope workspaceScope, includeBuild bool, deadline time.Time, visit func(string, string, fs.FileInfo) bool) (bool, error) {
	start := scope.root
	if scope.file != "" {
		start = scope.file
	}
	truncated := false
	err := filepath.WalkDir(start, func(file string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if file == start {
				return walkErr
			}
			return nil
		}
		if time.Now().After(deadline) {
			truncated = true
			return stoppedWalking
		}
		if item.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if item.IsDir() {
			if file != start && (item.Name() == ".git" || (!includeBuild && generatedFolders[item.Name()])) {
				return filepath.SkipDir
			}
			return nil
		}
		info, infoErr := item.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return nil
		}
		relative, relErr := filepath.Rel(scope.root, file)
		if relErr != nil {
			return nil
		}
		if !visit(file, filepath.ToSlash(relative), info) {
			truncated = true
			return stoppedWalking
		}
		return nil
	})
	if errors.Is(err, stoppedWalking) {
		return truncated, nil
	}
	return truncated, err
}

func (p *plugin) indexFiles(request workspaceRequest) (any, *dbxpluginsdk.PluginError) {
	scope, pluginErr := p.rootFor(request.WorkspaceID)
	if pluginErr != nil {
		return nil, pluginErr
	}
	result := make([]entry, 0, 256)
	truncated, err := walkWorkspaceFiles(scope, false, time.Now().Add(10*time.Second), func(_ string, relative string, info fs.FileInfo) bool {
		result = append(result, entry{Name: filepath.Base(relative), Path: relative, Kind: "file", Size: info.Size()})
		return len(result) < maxIndexedFiles
	})
	if err != nil {
		return nil, internalError(err)
	}
	return map[string]any{"entries": result, "truncated": truncated}, nil
}

func (p *plugin) search(request searchRequest) (any, *dbxpluginsdk.PluginError) {
	query := strings.TrimSpace(request.Query)
	if query == "" || utf8.RuneCountInString(query) > 200 || strings.ContainsAny(query, "\r\n\x00") {
		return nil, invalidRequest("Enter a search term of up to 200 characters")
	}
	scope, pluginErr := p.rootFor(request.WorkspaceID)
	if pluginErr != nil {
		return nil, pluginErr
	}
	pattern := regexp.QuoteMeta(query)
	if !request.CaseSensitive {
		pattern = "(?i)" + pattern
	}
	matcher, err := regexp.Compile(pattern)
	if err != nil {
		return nil, invalidRequest("Invalid search term")
	}
	matches := make([]searchMatch, 0, 32)
	filesScanned := 0
	truncated, err := walkWorkspaceFiles(scope, request.IncludeBuild, time.Now().Add(12*time.Second), func(file, relative string, info fs.FileInfo) bool {
		if filesScanned >= maxIndexedFiles {
			return false
		}
		if info.Size() > maxFileBytes {
			return true
		}
		raw, readErr := os.ReadFile(file)
		if readErr != nil || len(raw) > maxFileBytes {
			return true
		}
		content, _, decodeErr := decodeText(raw, "")
		if decodeErr != nil {
			return true
		}
		filesScanned++
		for lineNumber, offset := 1, 0; offset <= len(content); lineNumber++ {
			end := strings.IndexByte(content[offset:], '\n')
			if end < 0 {
				end = len(content)
			} else {
				end += offset
			}
			line := strings.TrimSuffix(content[offset:end], "\r")
			if position := matcher.FindStringIndex(line); position != nil {
				column := 1
				for _, r := range line[:position[0]] {
					if r > 0xffff {
						column += 2
					} else {
						column++
					}
				}
				matches = append(matches, searchMatch{Path: relative, Line: lineNumber, Column: column, Preview: searchExcerpt(line, position[0], position[1])})
				if len(matches) >= maxSearchMatches {
					return false
				}
			}
			if end == len(content) {
				break
			}
			offset = end + 1
		}
		return true
	})
	if err != nil {
		return nil, internalError(err)
	}
	return map[string]any{"matches": matches, "filesScanned": filesScanned, "truncated": truncated}, nil
}

func searchExcerpt(line string, from, to int) string {
	runes := []rune(line)
	start := utf8.RuneCountInString(line[:from])
	end := start + utf8.RuneCountInString(line[from:to])
	left := start - 70
	if left < 0 {
		left = 0
	}
	right := end + 110
	if right > len(runes) {
		right = len(runes)
	}
	if right-left > 320 {
		right = left + 320
	}
	preview := strings.TrimSpace(string(runes[left:right]))
	if left > 0 {
		preview = "…" + preview
	}
	if right < len(runes) {
		preview += "…"
	}
	return preview
}
