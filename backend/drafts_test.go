package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

func TestDraftsPersistAndDelete(t *testing.T) {
	store := &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	draft := draftRecord{ID: "12345678-abcd-1234-abcd-123456789abc", Name: "Untitled-1", Content: "first note\n", LanguageID: "markdown", LanguageAuto: false, Selection: 7}
	if err := store.save(draft); err != nil {
		t.Fatal(err)
	}
	otherProcess := &draftStore{dir: store.dir}
	ids, next, err := otherProcess.listIDs("")
	if err != nil || len(ids) != 1 || ids[0] != draft.ID || next != "" {
		t.Fatalf("saved draft should survive store recreation: %#v, %q, %v", ids, next, err)
	}
	listed, err := otherProcess.read(draft.ID)
	if err != nil || listed.Content != draft.Content || listed.LanguageID != draft.LanguageID {
		t.Fatalf("saved draft should be readable: %#v, %v", listed, err)
	}
	info, err := os.Stat(filepath.Join(store.dir, draft.ID+".json"))
	if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("draft should be private: %v, %v", info, err)
	}
	draft.Content = "edited note\n"
	if err := otherProcess.save(draft); err != nil {
		t.Fatal(err)
	}
	listed, err = store.read(draft.ID)
	if err != nil || listed.Content != draft.Content {
		t.Fatalf("draft should update in place: %#v, %v", listed, err)
	}
	if err := store.delete(draft.ID); err != nil {
		t.Fatal(err)
	}
	ids, _, err = otherProcess.listIDs("")
	if err != nil || len(ids) != 0 {
		t.Fatalf("closed draft should stay deleted: %#v, %v", ids, err)
	}
}

func TestDraftStoreRejectsTraversalAndSymlinkDirectory(t *testing.T) {
	parent := t.TempDir()
	store := &draftStore{dir: filepath.Join(parent, "drafts")}
	if err := store.save(draftRecord{ID: "../outside", Name: "Outside", Content: "secret"}); err == nil {
		t.Fatal("traversal ID should be rejected")
	}
	outside := filepath.Join(parent, "outside")
	if err := os.Mkdir(outside, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, store.dir); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, _, err := store.listIDs(""); err == nil {
		t.Fatal("symlink draft directory should be rejected")
	}
}

func TestDraftRPCReopensSavedNote(t *testing.T) {
	store := &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	first := &plugin{workspaces: make(map[string]workspaceScope), drafts: store}
	draft := draftRecord{ID: "12345678-abcd-1234-abcd-123456789abc", Name: "Untitled-1", Content: "remember this", LanguageID: "plain", LanguageAuto: true}
	request, _ := json.Marshal(draft)
	if _, pluginErr := first.Handle(dbxpluginsdk.RequestContext{}, "draft/save", request, nil); pluginErr != nil {
		t.Fatalf("save draft: %s", pluginErr.Message)
	}
	reopened := &plugin{workspaces: make(map[string]workspaceScope), drafts: &draftStore{dir: store.dir}}
	result, pluginErr := reopened.Handle(dbxpluginsdk.RequestContext{}, "draft/list", json.RawMessage(`{}`), nil)
	if pluginErr != nil {
		t.Fatalf("list reopened drafts: %s", pluginErr.Message)
	}
	ids := result.(map[string]any)["ids"].([]string)
	if len(ids) != 1 || ids[0] != draft.ID {
		t.Fatalf("reopened note missing: %#v", ids)
	}
	readRequest, _ := json.Marshal(map[string]string{"id": draft.ID})
	result, pluginErr = reopened.Handle(dbxpluginsdk.RequestContext{}, "draft/read", readRequest, nil)
	if pluginErr != nil || result.(draftRecord).Content != draft.Content {
		t.Fatalf("reopened note content missing: %#v, %v", result, pluginErr)
	}
}

func TestDraftListingPaginatesWithoutDroppingTabs(t *testing.T) {
	store := &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	if err := store.ensureDirectory(); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 105; index++ {
		name := fmt.Sprintf("draft-%08d.json", index)
		if err := os.WriteFile(filepath.Join(store.dir, name), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	first, cursor, err := store.listIDs("")
	if err != nil || len(first) != 100 || cursor == "" {
		t.Fatalf("first page: %d, %q, %v", len(first), cursor, err)
	}
	second, cursor, err := store.listIDs(cursor)
	if err != nil || len(second) != 5 || cursor != "" {
		t.Fatalf("second page: %d, %q, %v", len(second), cursor, err)
	}
}

func TestEditorPreferencesPersist(t *testing.T) {
	store := &draftStore{dir: filepath.Join(t.TempDir(), "drafts")}
	projectA := filepath.Join(t.TempDir(), "project-a")
	projectB := filepath.Join(t.TempDir(), "project-b")
	want := editorPreferences{RecentFolders: []string{projectA, projectB}, RecentPositions: []filePosition{{Path: filepath.Join(projectA, "readme.txt"), Selection: 123, ScrollTop: 456}}, Session: editorSession{WorkspacePath: projectA, OpenFiles: []string{"readme.txt"}, ActiveFile: "readme.txt", ActiveDraft: "draft-12345678"}, Theme: "dark", EditorFont: "menlo", EditorFontSize: 15}
	if err := store.savePreferences(want); err != nil {
		t.Fatal(err)
	}
	got, err := (&draftStore{dir: store.dir}).loadPreferences()
	if err != nil || got.Theme != want.Theme || len(got.RecentFolders) != 2 || got.RecentFolders[0] != want.RecentFolders[0] || got.EditorFont != want.EditorFont || got.EditorFontSize != want.EditorFontSize || len(got.RecentPositions) != 1 || got.RecentPositions[0].ScrollTop != 456 || got.Session.WorkspacePath != want.Session.WorkspacePath || len(got.Session.OpenFiles) != 1 || got.Session.ActiveFile != "readme.txt" || got.Session.ActiveDraft != "draft-12345678" {
		t.Fatalf("preferences should survive restart: %#v, %v", got, err)
	}
	want.Session.OpenFiles = []string{"../outside.txt"}
	if err := store.savePreferences(want); err == nil {
		t.Fatal("session must reject paths outside the workspace")
	}
}
