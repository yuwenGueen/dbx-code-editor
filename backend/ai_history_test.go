package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestAIHistoryPersistenceAndProjectIsolation(t *testing.T) {
	root := t.TempDir()
	storage := &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	p, id := testWorkspace(t, root)
	p.drafts = storage
	call := func(p *plugin, id, method string, fields map[string]any) any {
		t.Helper()
		fields["workspaceId"] = id
		data, _ := json.Marshal(fields)
		result, e := p.aiHistory("ai/history/"+method, data)
		if e != nil {
			t.Fatalf("%s: %v", method, e)
		}
		return result
	}
	session := aiSession{ID: "session-1234", Title: "Example", State: json.RawMessage(`{"draft":"unfinished","mode":"ask","proposals":[{"path":"a","content":"next"}]}`), Messages: []aiMessage{{Role: "user", Content: strings.Repeat("test", 1000)}}}
	call(p, id, "save", map[string]any{"session": session})
	// A fresh plugin with a different workspace token can restore the same canonical project.
	restored, newID := testWorkspace(t, root)
	restored.drafts = storage
	record := call(restored, newID, "read", map[string]any{"id": session.ID}).(aiSession)
	if record.Messages[0].Content != session.Messages[0].Content {
		t.Fatal("conversation was truncated")
	}
	if string(record.State) != string(session.State) {
		t.Fatal("session state lost on restart")
	}
	list := call(restored, newID, "list", map[string]any{}).([]aiSession)
	if len(list) != 1 || list[0].Messages != nil || list[0].UpdatedAt == 0 {
		t.Fatal("invalid history metadata")
	}
	other, otherID := testWorkspace(t, t.TempDir())
	other.drafts = storage
	if len(call(other, otherID, "list", map[string]any{}).([]aiSession)) != 0 {
		t.Fatal("history leaked between projects")
	}
	session.Title = "Renamed"
	call(restored, newID, "save", map[string]any{"session": session})
	if call(restored, newID, "read", map[string]any{"id": session.ID}).(aiSession).Title != "Renamed" {
		t.Fatal("rename failed")
	}
	for _, bad := range []string{"../escape", "short"} {
		data, _ := json.Marshal(map[string]string{"workspaceId": newID, "id": bad})
		if _, e := restored.aiHistory("ai/history/delete", data); e == nil {
			t.Fatal("invalid ID accepted")
		}
	}
	call(restored, newID, "delete", map[string]any{"id": session.ID})
	if len(call(restored, newID, "list", map[string]any{}).([]aiSession)) != 0 {
		t.Fatal("delete failed")
	}
}

func TestAIHistoryReadsLegacyChat(t *testing.T) {
	root := t.TempDir()
	p, id := testWorkspace(t, root)
	p.drafts = &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	scope, e := p.rootFor(id)
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256([]byte(scope.root + "\x00"))
	store := &draftStore{dir: filepath.Join(filepath.Dir(p.drafts.dir), "ai-history", hex.EncodeToString(hash[:]))}
	if err := store.save(draftRecord{ID: "legacy-123", Name: "Legacy", Content: `[{"role":"user","content":"hello"}]`}); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(map[string]string{"workspaceId": id, "id": "legacy-123"})
	result, e := p.aiHistory("ai/history/read", data)
	if e != nil {
		t.Fatal(e)
	}
	record := result.(aiSession)
	if len(record.Messages) != 1 || record.Messages[0].Content != "hello" || len(record.State) != 0 {
		t.Fatal("legacy compatibility failed")
	}
}
