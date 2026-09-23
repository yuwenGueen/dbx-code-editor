package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectSearchRecursesAndRespectsOptions(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src", "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"src/nested/main.go":  "前😀关键字\nkeyword\n",
		"README.md":           "KEYWORD\n",
		"node_modules/lib.js": "keyword\n",
	} {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(name)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "binary.dat"), []byte{0, 1, 2, 3}, 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("keyword"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked.txt")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	p, id := testWorkspace(t, root)
	result, pluginErr := p.search(searchRequest{WorkspaceID: id, Query: "keyword"})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	matches := result.(map[string]any)["matches"].([]searchMatch)
	if len(matches) != 2 || matches[0].Path != "README.md" || matches[1].Path != "src/nested/main.go" {
		t.Fatalf("unexpected default search results: %#v", matches)
	}
	result, pluginErr = p.search(searchRequest{WorkspaceID: id, Query: "keyword", CaseSensitive: true, IncludeBuild: true})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	matches = result.(map[string]any)["matches"].([]searchMatch)
	if len(matches) != 2 || matches[0].Path != "node_modules/lib.js" || matches[1].Path != "src/nested/main.go" {
		t.Fatalf("unexpected case-sensitive results: %#v", matches)
	}
	result, pluginErr = p.search(searchRequest{WorkspaceID: id, Query: "关键字"})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	matches = result.(map[string]any)["matches"].([]searchMatch)
	if len(matches) != 1 || matches[0].Line != 1 || matches[0].Column != 4 {
		t.Fatalf("unexpected Unicode match position: %#v", matches)
	}
}

func TestFileIndexIncludesLargeFilesButNotLinksOrDependencies(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "node_modules"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "novel.txt"), make([]byte, 3<<20), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", "dep.js"), []byte("dependency"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "novel.txt"), filepath.Join(root, "link.txt")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	p, id := testWorkspace(t, root)
	result, pluginErr := p.indexFiles(workspaceRequest{WorkspaceID: id})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	files := result.(map[string]any)["entries"].([]entry)
	if len(files) != 1 || files[0].Path != "novel.txt" || files[0].Size != 3<<20 {
		t.Fatalf("unexpected file index: %#v", files)
	}
}

func TestSearchInSingleFileWorkspaceStaysOnSelectedFile(t *testing.T) {
	root := t.TempDir()
	selected := filepath.Join(root, "selected.txt")
	if err := os.WriteFile(selected, []byte("needle"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sibling.txt"), []byte("needle"), 0600); err != nil {
		t.Fatal(err)
	}
	p := &plugin{workspaces: make(map[string]workspaceScope)}
	opened, pluginErr := p.openFileWorkspace(selected)
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	id := opened.(map[string]any)["workspaceId"].(string)
	result, pluginErr := p.search(searchRequest{WorkspaceID: id, Query: "needle", IncludeBuild: true})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	matches := result.(map[string]any)["matches"].([]searchMatch)
	if len(matches) != 1 || matches[0].Path != "selected.txt" {
		t.Fatalf("single-file search leaked sibling files: %#v", matches)
	}
}
