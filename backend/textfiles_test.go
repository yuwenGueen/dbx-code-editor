package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func requestJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestTextEncodingsRoundTrip(t *testing.T) {
	cases := []struct{ name, text string }{
		{"utf-8", "第一章\n你好，世界。\n"},
		{"utf-8-bom", "第一章\n你好，世界。\n"},
		{"utf-16le", "第一章\n你好，世界。\n"},
		{"utf-16be", "第一章\n你好，世界。\n"},
		{"gb18030", "第一章\n你好，世界。\n"},
		{"big5", "第一章\n你好，世界。\n"},
		{"shift_jis", "第一章\nこんにちは。\n"},
		{"euc-kr", "첫 장\n안녕하세요.\n"},
		{"windows-1252", "Chapter one\nCafé résumé.\n"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, "book.txt")
			original := []byte{}
			if test.name == "utf-16le" {
				original = []byte{0xff, 0xfe}
			}
			if test.name == "utf-16be" {
				original = []byte{0xfe, 0xff}
			}
			raw, err := encodeText(test.text, test.name, original)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, raw, 0600); err != nil {
				t.Fatal(err)
			}
			p, id := testWorkspace(t, root)
			result, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "book.txt", Encoding: test.name})
			if pluginErr != nil {
				t.Fatal(pluginErr.Message)
			}
			decoded := result.(map[string]any)
			if decoded["content"] != test.text {
				t.Fatalf("decoded content: %q", decoded["content"])
			}
			_, pluginErr = p.save(saveRequest{WorkspaceID: id, Path: "book.txt", ExpectedRevision: decoded["revision"].(string), Encoding: test.name, Content: test.text + "End.\n"})
			if pluginErr != nil {
				t.Fatal(pluginErr.Message)
			}
			saved, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Equal(saved, raw) {
				t.Fatal("save did not update file")
			}
			if test.name == "utf-8-bom" && !bytes.HasPrefix(saved, []byte{0xef, 0xbb, 0xbf}) {
				t.Fatal("UTF-8 BOM lost")
			}
			if strings.HasPrefix(test.name, "utf-16") && !bytes.Equal(saved[:2], original) {
				t.Fatal("UTF-16 BOM lost")
			}
			text, name, err := decodeText(saved, test.name)
			if err != nil || name != test.name || text != test.text+"End.\n" {
				t.Fatalf("round trip: %q %q %v", text, name, err)
			}
		})
	}
}

func TestLargeNovelChunkedReadAndSave(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "novel.txt")
	novel := strings.Repeat("这是一段长篇小说。\n", 160000)
	raw, err := encodeText(novel, "gb18030", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) <= 2<<20 {
		t.Fatalf("test novel should exceed old limit: %d", len(raw))
	}
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	p, id := testWorkspace(t, root)
	result, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "novel.txt"})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	metadata := result.(map[string]any)
	if metadata["encoding"] != "gb18030" {
		t.Fatalf("encoding: %v", metadata["encoding"])
	}
	readID := metadata["readId"].(string)
	var parts []string
	for i := 0; i < metadata["chunks"].(int); i++ {
		part, pluginErr := p.readChunk(requestJSON(t, map[string]any{"workspaceId": id, "readId": readID, "index": i}))
		if pluginErr != nil {
			t.Fatal(pluginErr.Message)
		}
		parts = append(parts, part.(map[string]any)["content"].(string))
	}
	if strings.Join(parts, "") != novel {
		t.Fatal("chunked read lost text")
	}
	start, pluginErr := p.saveStart(requestJSON(t, saveRequest{WorkspaceID: id, Path: "novel.txt", ExpectedRevision: metadata["revision"].(string), Encoding: "gb18030"}))
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	saveID := start.(map[string]string)["saveId"]
	for _, part := range splitText(novel + "全书完。\n") {
		_, pluginErr = p.saveChunk(requestJSON(t, map[string]any{"workspaceId": id, "saveId": saveID, "content": part}))
		if pluginErr != nil {
			t.Fatal(pluginErr.Message)
		}
	}
	if _, pluginErr = p.saveCommit(requestJSON(t, map[string]any{"workspaceId": id, "saveId": saveID})); pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	saved, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	text, name, err := decodeText(saved, "")
	if err != nil || name != "gb18030" || text != novel+"全书完。\n" {
		t.Fatalf("saved novel: encoding=%q error=%v", name, err)
	}
}

func TestSelectedFileCannotAccessSibling(t *testing.T) {
	root := t.TempDir()
	selected := filepath.Join(root, "selected.txt")
	if err := os.WriteFile(selected, []byte("selected"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "private.txt"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	p := &plugin{workspaces: make(map[string]workspaceScope)}
	result, pluginErr := p.openFileWorkspace(selected)
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	id := result.(map[string]any)["workspaceId"].(string)
	listed, pluginErr := p.list(workspaceRequest{WorkspaceID: id})
	if pluginErr != nil || len(listed.(map[string]any)["entries"].([]entry)) != 1 {
		t.Fatal("single-file list should only contain selected file")
	}
	if _, pluginErr := p.read(workspaceRequest{WorkspaceID: id, Path: "private.txt"}); pluginErr == nil {
		t.Fatal("sibling read should be rejected")
	}
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "new.txt", Kind: "file"}); pluginErr == nil {
		t.Fatal("single-file workspace should reject create")
	}
}
