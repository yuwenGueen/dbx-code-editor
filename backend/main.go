package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const maxFileBytes = 32 << 20

type workspaceScope struct {
	root string
	file string // A selected file grants access to that file only.
}

type plugin struct {
	mu         sync.RWMutex
	workspaces map[string]workspaceScope
	drafts     *draftStore
	reads      map[string]readSession
	writes     map[string]*writeSession
	pickerOpen bool
}

type workspaceRequest struct {
	WorkspaceID string `json:"workspaceId"`
	Path        string `json:"path"`
	Encoding    string `json:"encoding,omitempty"`
}

type saveRequest struct {
	WorkspaceID      string `json:"workspaceId"`
	Path             string `json:"path"`
	Content          string `json:"content"`
	ExpectedRevision string `json:"expectedRevision"`
	Encoding         string `json:"encoding,omitempty"`
}

type createRequest struct {
	WorkspaceID string `json:"workspaceId"`
	Path        string `json:"path"`
	Kind        string `json:"kind"`
	Content     string `json:"content"`
}

type entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
}

func (p *plugin) Handle(_ dbxpluginsdk.RequestContext, method string, params json.RawMessage, _ *dbxpluginsdk.Emitter) (any, *dbxpluginsdk.PluginError) {
	switch method {
	case "workspace/open":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid workspace path")
		}
		return p.openWorkspace(request.Path)
	case "workspace/pickFolder":
		return p.pickOnce(pickFolder)
	case "workspace/pickFile":
		return p.pickOnce(pickFile)
	case "workspace/openFile":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid file path")
		}
		return p.openFileWorkspace(request.Path)
	case "draft/list":
		var request struct {
			After string `json:"after"`
		}
		if len(params) != 0 && json.Unmarshal(params, &request) != nil {
			return nil, invalidRequest("Invalid temporary draft cursor")
		}
		ids, next, err := p.drafts.listIDs(request.After)
		if err != nil {
			return nil, internalError(err)
		}
		return map[string]any{"ids": ids, "next": next}, nil
	case "draft/read":
		var request struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid temporary draft ID")
		}
		record, err := p.drafts.read(request.ID)
		if err != nil {
			return nil, invalidRequest(err.Error())
		}
		return record, nil
	case "draft/save":
		var request draftRecord
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid temporary draft")
		}
		if err := p.drafts.save(request); err != nil {
			return nil, invalidRequest(err.Error())
		}
		return map[string]bool{"saved": true}, nil
	case "draft/delete":
		var request struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid temporary draft ID")
		}
		if err := p.drafts.delete(request.ID); err != nil {
			return nil, invalidRequest(err.Error())
		}
		return map[string]bool{"deleted": true}, nil
	case "preferences/get":
		preferences, err := p.drafts.loadPreferences()
		if err != nil {
			return nil, internalError(err)
		}
		return preferences, nil
	case "preferences/save":
		var request editorPreferences
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid editor preferences")
		}
		if err := p.drafts.savePreferences(request); err != nil {
			return nil, invalidRequest(err.Error())
		}
		return map[string]bool{"saved": true}, nil
	case "workspace/list":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid directory request")
		}
		return p.list(request)
	case "workspace/search":
		var request searchRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid search request")
		}
		return p.search(request)
	case "workspace/index":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid file index request")
		}
		return p.indexFiles(request)
	case "workspace/read":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid file request")
		}
		return p.read(request)
	case "workspace/save":
		var request saveRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid save request")
		}
		return p.save(request)
	case "workspace/readChunk":
		return p.readChunk(params)
	case "workspace/readEnd":
		return p.readEnd(params)
	case "workspace/saveStart":
		return p.saveStart(params)
	case "workspace/saveChunk":
		return p.saveChunk(params)
	case "workspace/saveCommit":
		return p.saveCommit(params)
	case "workspace/create":
		var request createRequest
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, invalidRequest("Invalid create request")
		}
		return p.create(request)
	case "workspace/close":
		var request workspaceRequest
		if err := json.Unmarshal(params, &request); err != nil || request.WorkspaceID == "" {
			return nil, invalidRequest("Missing workspace ID")
		}
		p.mu.Lock()
		delete(p.workspaces, request.WorkspaceID)
		for id, session := range p.reads {
			if session.workspaceID == request.WorkspaceID {
				delete(p.reads, id)
			}
		}
		for id, session := range p.writes {
			if session.workspaceID == request.WorkspaceID {
				delete(p.writes, id)
			}
		}
		p.mu.Unlock()
		return map[string]bool{"success": true}, nil
	default:
		return nil, dbxpluginsdk.MethodNotFound(method)
	}
}

func (p *plugin) pickOnce(run func() (any, *dbxpluginsdk.PluginError)) (any, *dbxpluginsdk.PluginError) {
	p.mu.Lock()
	if p.pickerOpen {
		p.mu.Unlock()
		return map[string]bool{"busy": true}, nil
	}
	p.pickerOpen = true
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		p.pickerOpen = false
		p.mu.Unlock()
	}()
	return run()
}

func pickFolder() (any, *dbxpluginsdk.PluginError) {
	return nativePicker("folder")
}

func pickFile() (any, *dbxpluginsdk.PluginError) {
	return nativePicker("file")
}

func pickerCommand(platform, kind string) (string, []string, error) {
	switch platform {
	case "darwin":
		script := `POSIX path of (choose file with prompt "Choose a text file")`
		if kind == "folder" {
			script = `POSIX path of (choose folder with prompt "Choose a project folder")`
		}
		return "/usr/bin/osascript", []string{"-e", script}, nil
	case "windows":
		const prefix = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); `
		script := prefix + `$dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = 'Choose a text file'; $dialog.CheckFileExists = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }`
		if kind == "folder" {
			script = prefix + `$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Choose a project folder'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }`
		}
		return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-STA", "-Command", script}, nil
	case "linux":
		if executable, err := exec.LookPath("zenity"); err == nil {
			args := []string{"--file-selection", "--title=Choose a text file"}
			if kind == "folder" {
				args = []string{"--file-selection", "--directory", "--title=Choose a project folder"}
			}
			return executable, args, nil
		}
		if executable, err := exec.LookPath("kdialog"); err == nil {
			args := []string{"--title", "Choose a text file", "--getopenfilename"}
			if kind == "folder" {
				args = []string{"--title", "Choose a project folder", "--getexistingdirectory"}
			}
			return executable, args, nil
		}
		return "", nil, errors.New("Install zenity or kdialog to use the file picker; folders can also be opened by path")
	default:
		return "", nil, errors.New("Native file picker is unavailable on this platform")
	}
}

func nativePicker(kind string) (any, *dbxpluginsdk.PluginError) {
	executable, args, err := pickerCommand(runtime.GOOS, kind)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if runtime.GOOS == "darwin" && errors.As(err, &exitErr) && (bytes.Contains(exitErr.Stderr, []byte("-128")) || bytes.Contains(exitErr.Stderr, []byte("User canceled"))) {
			return map[string]bool{"cancelled": true}, nil
		}
		if runtime.GOOS == "linux" && errors.As(err, &exitErr) && exitErr.ExitCode() == 1 && len(bytes.TrimSpace(exitErr.Stderr)) == 0 {
			return map[string]bool{"cancelled": true}, nil
		}
		return nil, internalError(err)
	}
	selected := strings.TrimSpace(string(output))
	if selected == "" {
		return map[string]bool{"cancelled": true}, nil
	}
	return map[string]string{"path": selected}, nil
}

func (p *plugin) openWorkspace(rawPath string) (any, *dbxpluginsdk.PluginError) {
	root, err := canonicalDirectory(rawPath)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return nil, internalError(err)
	}
	id := hex.EncodeToString(token)
	p.mu.Lock()
	p.workspaces[id] = workspaceScope{root: root}
	p.mu.Unlock()
	return map[string]string{"workspaceId": id, "path": root, "name": filepath.Base(root)}, nil
}

func (p *plugin) openFileWorkspace(rawPath string) (any, *dbxpluginsdk.PluginError) {
	file, err := canonicalFile(rawPath)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	id, err := newToken()
	if err != nil {
		return nil, internalError(err)
	}
	p.mu.Lock()
	p.workspaces[id] = workspaceScope{root: filepath.Dir(file), file: file}
	p.mu.Unlock()
	return map[string]any{"workspaceId": id, "path": file, "name": filepath.Base(file), "singleFile": true, "selectedFile": filepath.Base(file)}, nil
}

func canonicalFile(rawPath string) (string, error) {
	if strings.TrimSpace(rawPath) == "" {
		return "", errors.New("Choose a file")
	}
	if rawPath == "~" || strings.HasPrefix(rawPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		rawPath = filepath.Join(home, strings.TrimPrefix(rawPath, "~/"))
	}
	abs, err := filepath.Abs(rawPath)
	if err != nil {
		return "", err
	}
	file, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("File not found: %w", err)
	}
	info, err := os.Stat(file)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("Path is not a regular file")
	}
	return file, nil
}

func canonicalDirectory(rawPath string) (string, error) {
	rawPath = strings.TrimSpace(rawPath)
	if rawPath == "" {
		return "", errors.New("Enter a folder path")
	}
	if rawPath == "~" || strings.HasPrefix(rawPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		rawPath = filepath.Join(home, strings.TrimPrefix(rawPath, "~/"))
	}
	abs, err := filepath.Abs(rawPath)
	if err != nil {
		return "", err
	}
	root, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("Folder not found: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("Path is not a folder")
	}
	return root, nil
}

func (p *plugin) rootFor(id string) (workspaceScope, *dbxpluginsdk.PluginError) {
	p.mu.RLock()
	scope, exists := p.workspaces[id]
	p.mu.RUnlock()
	if !exists {
		return workspaceScope{}, invalidRequest("Workspace is closed. Open it again")
	}
	return scope, nil
}

func (p *plugin) fileFor(request workspaceRequest) (string, *dbxpluginsdk.PluginError) {
	scope, pluginErr := p.rootFor(request.WorkspaceID)
	if pluginErr != nil {
		return "", pluginErr
	}
	file, pluginErr := resolvePath(scope.root, request.Path)
	if pluginErr != nil {
		return "", pluginErr
	}
	if scope.file != "" && file != scope.file {
		return "", invalidRequest("Only the selected file can be accessed")
	}
	return file, nil
}

func resolvePath(root, relative string) (string, *dbxpluginsdk.PluginError) {
	if strings.ContainsRune(relative, 0) {
		return "", invalidRequest("Invalid path")
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", invalidRequest("Path must stay inside the opened folder")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, clean))
	if err != nil {
		return "", internalError(err)
	}
	back, err := filepath.Rel(root, resolved)
	if err != nil || back == ".." || strings.HasPrefix(back, ".."+string(filepath.Separator)) {
		return "", invalidRequest("Path must stay inside the opened folder")
	}
	return resolved, nil
}

func (p *plugin) list(request workspaceRequest) (any, *dbxpluginsdk.PluginError) {
	scope, pluginErr := p.rootFor(request.WorkspaceID)
	if pluginErr != nil {
		return nil, pluginErr
	}
	if scope.file != "" {
		if request.Path != "" && request.Path != "." {
			return nil, invalidRequest("Only the selected file can be accessed")
		}
		info, err := os.Stat(scope.file)
		if err != nil {
			return nil, internalError(err)
		}
		return map[string]any{"entries": []entry{{Name: filepath.Base(scope.file), Path: filepath.Base(scope.file), Kind: "file", Size: info.Size()}}}, nil
	}
	directory, pluginErr := resolvePath(scope.root, request.Path)
	if pluginErr != nil {
		return nil, pluginErr
	}
	items, err := os.ReadDir(directory)
	if err != nil {
		return nil, internalError(err)
	}
	if len(items) > 3000 {
		return nil, invalidRequest("Folder has too many entries (limit 3000)")
	}
	result := make([]entry, 0, len(items))
	for _, item := range items {
		kind := "file"
		if item.IsDir() {
			kind = "directory"
		} else if item.Type()&os.ModeSymlink != 0 {
			kind = "symlink"
		}
		info, err := item.Info()
		if err != nil {
			continue
		}
		result = append(result, entry{
			Name: item.Name(),
			Path: path.Join(filepath.ToSlash(request.Path), item.Name()),
			Kind: kind,
			Size: info.Size(),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Kind == "directory" && result[j].Kind != "directory" {
			return true
		}
		if result[i].Kind != "directory" && result[j].Kind == "directory" {
			return false
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return map[string]any{"entries": result}, nil
}

func (p *plugin) read(request workspaceRequest) (any, *dbxpluginsdk.PluginError) {
	return p.readText(request)
}

func (p *plugin) save(request saveRequest) (any, *dbxpluginsdk.PluginError) {
	return p.saveText(request)
}

func writeFileAtomically(file string, info os.FileInfo, content []byte) (any, *dbxpluginsdk.PluginError) {
	temporary, err := os.CreateTemp(filepath.Dir(file), ".dbx-code-*")
	if err != nil {
		return nil, internalError(err)
	}
	defer os.Remove(temporary.Name())
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		temporary.Close()
		return nil, internalError(err)
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return nil, internalError(err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return nil, internalError(err)
	}
	if err := temporary.Close(); err != nil {
		return nil, internalError(err)
	}
	if err := os.Rename(temporary.Name(), file); err != nil {
		return nil, internalError(err)
	}
	return map[string]any{"revision": revision(content)}, nil
}

func (p *plugin) create(request createRequest) (any, *dbxpluginsdk.PluginError) {
	if request.Kind != "file" && request.Kind != "directory" {
		return nil, invalidRequest("Choose a file or folder")
	}
	if (request.Kind == "directory" && request.Content != "") || len(request.Content) > maxFileBytes || !utf8.ValidString(request.Content) || strings.ContainsRune(request.Content, 0) {
		return nil, invalidRequest("Invalid file contents")
	}
	scope, pluginErr := p.rootFor(request.WorkspaceID)
	if pluginErr != nil {
		return nil, pluginErr
	}
	if scope.file != "" {
		return nil, invalidRequest("Cannot create files in a single-file workspace. Open a folder first")
	}
	if strings.ContainsRune(request.Path, 0) || strings.TrimSpace(request.Path) == "" {
		return nil, invalidRequest("Enter a name")
	}
	clean := filepath.Clean(filepath.FromSlash(request.Path))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil, invalidRequest("Path must stay inside the opened folder")
	}
	parent, pluginErr := resolvePath(scope.root, filepath.Dir(clean))
	if pluginErr != nil {
		return nil, pluginErr
	}
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return nil, invalidRequest("Parent folder does not exist")
	}
	file := filepath.Join(parent, filepath.Base(clean))
	if request.Kind == "directory" {
		if err := os.Mkdir(file, 0755); err != nil {
			return nil, internalError(err)
		}
	} else {
		handle, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			return nil, internalError(err)
		}
		if _, err := io.WriteString(handle, request.Content); err != nil {
			handle.Close()
			os.Remove(file)
			return nil, internalError(err)
		}
		if err := handle.Close(); err != nil {
			os.Remove(file)
			return nil, internalError(err)
		}
	}
	return map[string]any{
		"entry":    entry{Name: filepath.Base(clean), Path: filepath.ToSlash(clean), Kind: request.Kind},
		"revision": revision([]byte(request.Content)),
	}, nil
}

func revision(content []byte) string {
	hash := sha256.Sum256(content)
	return hex.EncodeToString(hash[:])
}

func invalidRequest(message string) *dbxpluginsdk.PluginError {
	return dbxpluginsdk.NewError(-32602, message)
}

func internalError(err error) *dbxpluginsdk.PluginError {
	return dbxpluginsdk.NewError(-32000, err.Error())
}

func main() {
	metadata := dbxpluginsdk.Metadata{ID: "io.github.yuwengueen.dbx-code-editor", Version: "0.1.15", Capabilities: []string{}}
	store, err := newDraftStore()
	if err != nil {
		log.Fatal(err)
	}
	server := dbxpluginsdk.NewServer(metadata, &plugin{workspaces: make(map[string]workspaceScope), drafts: store})
	if err := server.Serve(); err != nil {
		log.Fatal(err)
	}
}
