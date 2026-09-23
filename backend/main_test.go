package main

import (
	"os"
	"path/filepath"
	"testing"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

func testWorkspace(t *testing.T, root string) (*plugin, string) {
	t.Helper()
	p := &plugin{workspaces: make(map[string]workspaceScope)}
	result, pluginErr := p.openWorkspace(root)
	if pluginErr != nil {
		t.Fatalf("open workspace: %s", pluginErr.Message)
	}
	return p, result.(map[string]string)["workspaceId"]
}

func TestWorkspacePathsStayInsideRoot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "project")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(parent, "outside.txt")
	if err := os.WriteFile(outside, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, pluginErr := resolvePath(root, "../outside.txt"); pluginErr == nil {
		t.Fatal("parent traversal should be rejected")
	}
	if _, pluginErr := resolvePath(root, outside); pluginErr == nil {
		t.Fatal("absolute paths should be rejected")
	}
	link := filepath.Join(root, "link.txt")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, pluginErr := resolvePath(root, "link.txt"); pluginErr == nil {
		t.Fatal("symlink escaping the root should be rejected")
	}
}

func TestPreviouslySelectedFileCanBeOpenedAgain(t *testing.T) {
	file := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(file, []byte("a local note"), 0600); err != nil {
		t.Fatal(err)
	}
	p := &plugin{workspaces: make(map[string]workspaceScope)}
	for attempt := 0; attempt < 2; attempt++ {
		opened, pluginErr := p.openFileWorkspace(file)
		if pluginErr != nil {
			t.Fatalf("open selected file: %s", pluginErr.Message)
		}
		id := opened.(map[string]any)["workspaceId"].(string)
		listed, pluginErr := p.list(workspaceRequest{WorkspaceID: id})
		if pluginErr != nil || len(listed.(map[string]any)["entries"].([]entry)) != 1 {
			t.Fatal("selected file should remain available in its workspace")
		}
		if _, pluginErr = p.read(workspaceRequest{WorkspaceID: id, Path: "notes.txt"}); pluginErr != nil {
			t.Fatalf("read selected file: %s", pluginErr.Message)
		}
	}
}

func TestNativePickerOnlyOpensOnce(t *testing.T) {
	p := &plugin{}
	opened := make(chan struct{})
	closePicker := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = p.pickOnce(func() (any, *dbxpluginsdk.PluginError) {
			close(opened)
			<-closePicker
			return map[string]bool{"cancelled": true}, nil
		})
	}()
	<-opened
	result, pluginErr := p.pickOnce(func() (any, *dbxpluginsdk.PluginError) {
		t.Fatal("a second picker opened while the first was active")
		return nil, nil
	})
	if pluginErr != nil || !result.(map[string]bool)["busy"] {
		t.Fatal("second picker call should be ignored")
	}
	close(closePicker)
	<-finished
	result, pluginErr = p.pickOnce(func() (any, *dbxpluginsdk.PluginError) {
		return map[string]bool{"cancelled": true}, nil
	})
	if pluginErr != nil || !result.(map[string]bool)["cancelled"] {
		t.Fatal("picker should be available again after closing")
	}
}

func TestSaveDetectsExternalChanges(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "script.sql")
	if err := os.WriteFile(file, []byte("select 1;"), 0600); err != nil {
		t.Fatal(err)
	}
	p, id := testWorkspace(t, root)
	readResult, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "script.sql"})
	if pluginErr != nil {
		t.Fatalf("read: %s", pluginErr.Message)
	}
	originalRevision := readResult.(map[string]any)["revision"].(string)
	if err := os.WriteFile(file, []byte("select 2;"), 0600); err != nil {
		t.Fatal(err)
	}
	_, pluginErr = p.save(saveRequest{WorkspaceID: id, Path: "script.sql", Content: "select 3;", ExpectedRevision: originalRevision})
	if pluginErr == nil {
		t.Fatal("save should reject a stale revision")
	}
	contents, err := os.ReadFile(file)
	if err != nil || string(contents) != "select 2;" {
		t.Fatalf("external contents should be preserved: %q, %v", contents, err)
	}
	updatedRevision := revision(contents)
	_, pluginErr = p.save(saveRequest{WorkspaceID: id, Path: "script.sql", Content: "select 3;", ExpectedRevision: updatedRevision})
	if pluginErr != nil {
		t.Fatalf("save current revision: %s", pluginErr.Message)
	}
	contents, err = os.ReadFile(file)
	if err != nil || string(contents) != "select 3;" {
		t.Fatalf("expected saved contents: %q, %v", contents, err)
	}
}

func TestReadRejectsBinaryAndOversizedFiles(t *testing.T) {
	root := t.TempDir()
	p, id := testWorkspace(t, root)
	if err := os.WriteFile(filepath.Join(root, "binary"), []byte{0, 1, 2}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "binary"}); pluginErr == nil {
		t.Fatal("binary file should be rejected")
	}
	if err := os.WriteFile(filepath.Join(root, "large"), make([]byte, maxFileBytes+1), 0600); err != nil {
		t.Fatal(err)
	}
	if _, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "large"}); pluginErr == nil {
		t.Fatal("oversized file should be rejected")
	}
}

func TestCreateFileAndFolderInsideWorkspace(t *testing.T) {
	root := t.TempDir()
	p, id := testWorkspace(t, root)
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "src", Kind: "directory"}); pluginErr != nil {
		t.Fatalf("create folder: %s", pluginErr.Message)
	}
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "src/main.ts", Kind: "file", Content: "const answer = 42;\n"}); pluginErr != nil {
		t.Fatalf("create file: %s", pluginErr.Message)
	}
	readResult, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "src/main.ts"})
	if pluginErr != nil {
		t.Fatalf("read new file: %s", pluginErr.Message)
	}
	if readResult.(map[string]any)["content"] != "const answer = 42;\n" {
		t.Fatal("new file contents should be preserved")
	}
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "src/main.ts", Kind: "file"}); pluginErr == nil {
		t.Fatal("creating an existing file should fail")
	}
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "../outside.ts", Kind: "file"}); pluginErr == nil {
		t.Fatal("creating outside the workspace should fail")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "outside.ts")); !os.IsNotExist(err) {
		t.Fatalf("outside file should not exist: %v", err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err == nil {
		if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "escape/nope.ts", Kind: "file"}); pluginErr == nil {
			t.Fatal("creating through an escaping symlink should fail")
		}
	}
}
