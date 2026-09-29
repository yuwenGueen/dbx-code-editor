package main

import (
	"context"
	"encoding/json"
	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type devTask struct {
	mu      sync.Mutex
	output  string
	done    bool
	success bool
	cancel  context.CancelFunc
}

func (j *devTask) Write(b []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.output += string(b)
	if len(j.output) > 16000 {
		j.output = j.output[len(j.output)-16000:]
	}
	return len(b), nil
}
func (p *plugin) devTaskCall(method string, raw json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var r struct {
		WorkspaceID string `json:"workspaceId"`
		Script      string `json:"script"`
		URL         string `json:"url"`
	}
	if json.Unmarshal(raw, &r) != nil {
		return nil, invalidRequest("Invalid task")
	}
	scope, e := p.rootFor(r.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if scope.file != "" {
		return nil, invalidRequest("Open a folder")
	}
	if method == "dev/preview" {
		u, err := url.Parse(r.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
			return nil, invalidRequest("Only local preview URLs are allowed")
		}
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "darwin":
			cmd = exec.Command("open", u.String())
		case "windows":
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u.String())
		default:
			cmd = exec.Command("xdg-open", u.String())
		}
		if err = cmd.Run(); err != nil {
			return nil, invalidRequest("Cannot open preview browser")
		}
		return nil, nil
	}
	if method == "dev/info" {
		file, e := resolvePath(scope.root, "package.json")
		if e != nil {
			return map[string]any{"scripts": map[string]string{}}, nil
		}
		data, err := os.ReadFile(file)
		if err != nil || len(data) > 256*1024 {
			return nil, invalidRequest("Cannot read package.json")
		}
		var pkg struct {
			Scripts map[string]string `json:"scripts"`
		}
		if json.Unmarshal(data, &pkg) != nil {
			return nil, invalidRequest("Invalid package.json")
		}
		result := map[string]string{}
		for _, k := range []string{"check", "build", "test", "plugin:dev", "dev"} {
			if v := pkg.Scripts[k]; v != "" {
				result[k] = v
			}
		}
		_, err = os.Stat(filepath.Join(scope.root, "manifest.json"))
		return map[string]any{"scripts": result, "plugin": err == nil}, nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.devTasks == nil {
		p.devTasks = map[string]*devTask{}
	}
	job := p.devTasks[r.WorkspaceID]
	if method == "dev/status" {
		if job == nil {
			return map[string]any{"done": true, "output": ""}, nil
		}
		job.mu.Lock()
		defer job.mu.Unlock()
		return map[string]any{"done": job.done, "success": job.success, "output": strings.ReplaceAll(job.output, scope.root, "[project]")}, nil
	}
	if method == "dev/stop" {
		if job != nil {
			job.cancel()
		}
		return nil, nil
	}
	if method != "dev/start" {
		return nil, invalidRequest("Unknown task")
	}
	allowed := false
	for _, name := range []string{"check", "build", "test", "plugin:dev", "dev"} {
		if r.Script == name {
			allowed = true
		}
	}
	if !allowed {
		return nil, invalidRequest("Unsupported project task")
	}
	if job != nil {
		job.mu.Lock()
		running := !job.done
		job.mu.Unlock()
		if running {
			return nil, invalidRequest("Stop the current task first")
		}
	}
	duration := 2 * time.Minute
	if r.Script == "dev" || r.Script == "plugin:dev" {
		duration = 8 * time.Hour
	}
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	cmd := exec.CommandContext(ctx, "npm", "run", r.Script)
	cmd.Dir = scope.root
	cmd.Env = append(os.Environ(), "NO_COLOR=1", "CI=1")
	configureDevProcess(cmd)
	job = &devTask{cancel: cancel}
	cmd.Stdout = job
	cmd.Stderr = job
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, invalidRequest("Cannot start npm; check Node.js installation")
	}
	p.devTasks[r.WorkspaceID] = job
	go func() {
		err := cmd.Wait()
		cancel()
		job.mu.Lock()
		job.done = true
		job.success = err == nil
		job.mu.Unlock()
	}()
	return map[string]bool{"started": true}, nil
}
