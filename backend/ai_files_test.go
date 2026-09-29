package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAIFileReviewConflictAndUndo(t *testing.T) {
	root := t.TempDir()
	p, id := testWorkspace(t, root)
	call := func(mode, path, content, rev string) (any, bool) {
		b, _ := json.Marshal(map[string]string{"workspaceId": id, "mode": mode, "path": path, "content": content, "expectedRevision": rev})
		v, e := p.aiWrite(b)
		return v, e == nil
	}
	v, ok := call("create", "src/app.ts", "first", "")
	if !ok {
		t.Fatal("create")
	}
	rev := v.(map[string]any)["revision"].(string)
	if _, ok = call("create", "src/app.ts", "overwrite", ""); ok {
		t.Fatal("overwrote existing")
	}
	if _, ok = call("update", "src/app.ts", "second", "stale"); ok {
		t.Fatal("ignored revision")
	}
	if _, ok = call("update", "src/app.ts", "second", rev); !ok {
		t.Fatal("update")
	}
	if _, ok = call("undoCreate", "src/app.ts", "", rev); ok {
		t.Fatal("undo removed changed file")
	}
	if _, ok = call("undoCreate", "src/app.ts", "", revision([]byte("second"))); !ok {
		t.Fatal("undo")
	}
	for _, path := range []string{"../outside", "/outside", ".git/config", "a/../b", "a\\b"} {
		if _, ok = call("create", path, "bad", ""); ok {
			t.Fatalf("accepted %s", path)
		}
	}
	outside := t.TempDir()
	if os.Symlink(outside, filepath.Join(root, "link")) == nil {
		if _, ok = call("create", "link/escape", "bad", ""); ok {
			t.Fatal("followed symlink")
		}
	}
}
