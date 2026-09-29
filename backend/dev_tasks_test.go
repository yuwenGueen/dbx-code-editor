package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestDevTaskBoundedExecution(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm unavailable")
	}
	root := t.TempDir()
	p, id := testWorkspace(t, root)
	os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"check":"node -e \"console.log('CHECK_OK')\""}}`), 0600)
	call := func(method, script string) (any, bool) {
		b, _ := json.Marshal(map[string]string{"workspaceId": id, "script": script})
		v, e := p.devTaskCall(method, b)
		return v, e == nil
	}
	if _, ok := call("dev/start", "build; echo unsafe"); ok {
		t.Fatal("accepted arbitrary command")
	}
	if _, ok := call("dev/start", "check"); !ok {
		t.Fatal("start")
	}
	defer func() { call("dev/stop", "") }()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		v, _ := call("dev/status", "")
		state := v.(map[string]any)
		if state["done"] == true {
			if state["success"] != true {
				t.Fatal("check failed")
			}
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("task did not finish")
}
