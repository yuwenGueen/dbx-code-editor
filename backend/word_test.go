package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeWordFixture(t *testing.T, file string, parts map[string]string) {
	t.Helper()
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	for name, data := range parts {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func wordFixtureParts() map[string]string {
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
	return map[string]string{
		"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":         `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="CustomHeading"/></w:pPr><w:r><w:t>Word 导入演示</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">保留段落、</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:t>和</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r><w:r><w:t>。</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表第一项</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表第二项</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>无序列表</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>功能</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>效果</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>转换 | 预览</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:hyperlink r:id="link"><w:r><w:t>项目主页</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="image"/></w:drawing></w:r></w:p>
<w:p><w:r><w:t>&lt;script&gt;正文中的标记&lt;/script&gt;</w:t></w:r></w:p>
<w:p><w:del><w:r><w:t>已删除文字</w:t></w:r></w:del><w:ins><w:r><w:t>保留的修订</w:t></w:r></w:ins></w:p>
</w:body></w:document>`,
		"word/styles.xml":              `<w:styles xmlns:w="urn:w"><w:style w:styleId="CustomHeading"><w:basedOn w:val="Heading1"/></w:style><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
		"word/numbering.xml":           `<w:numbering xmlns:w="urn:w"><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num></w:numbering>`,
		"word/_rels/document.xml.rels": `<Relationships><Relationship Id="link" Target="https://example.com/docs" TargetMode="External"/><Relationship Id="image" Target="media/demo.png"/></Relationships>`,
		"word/media/demo.png":          string(png),
	}
}

func TestWordImportExportAndDraftRecovery(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "中文 + (文档).docx")
	writeWordFixture(t, source, wordFixtureParts())
	original, _ := os.ReadFile(source)
	p, workspaceID := testWorkspace(t, root)
	p.drafts = &draftStore{dir: filepath.Join(root, "drafts")}
	result, pluginErr := p.importWordFile(source)
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	record := result.(map[string]any)["draft"].(draftRecord)
	if result.(map[string]any)["warnings"].(int) != 0 {
		t.Fatal("unexpected conversion warnings")
	}
	for _, expected := range []string{"# Word 导入演示", "**粗体**", "*斜体*", "1. 列表第一项", "2. 列表第二项", "- 无序列表", "| 功能 | 效果 |", "转换 \\| 预览", "[项目主页](https://example.com/docs)", "&lt;script&gt;", "保留的修订"} {
		if !strings.Contains(record.Content, expected) {
			t.Errorf("missing %q in %s", expected, record.Content)
		}
	}
	if strings.Contains(record.Content, "已删除文字") {
		t.Fatal("deleted revision was imported")
	}
	if !strings.Contains(record.Content, wordAssetURL(record.WordImport.AssetFolder)+"/image-1.png") {
		t.Fatal("image link missing")
	}
	restored, err := (&draftStore{dir: p.drafts.dir}).read(record.ID)
	if err != nil || restored.WordImport == nil || restored.WordImport.ImageCount != 1 {
		t.Fatalf("draft metadata did not survive restart: %v", err)
	}
	params, _ := json.Marshal(map[string]string{"id": record.ID, "path": "image-1.png"})
	image, pluginErr := p.readImage(params, true)
	if pluginErr != nil || !strings.HasPrefix(image.(map[string]string)["url"], "data:image/png;base64,") {
		t.Fatal("draft image not readable")
	}
	saved, pluginErr := p.create(createRequest{WorkspaceID: workspaceID, Path: "导出 + (新).md", Kind: "file", Content: record.Content, DraftID: record.ID})
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	output, _ := os.ReadFile(filepath.Join(root, "导出 + (新).md"))
	if string(output) != saved.(map[string]any)["content"] || !strings.Contains(string(output), wordAssetURL("导出 + (新).assets")) {
		t.Fatal("renamed image references not saved")
	}
	if _, err := os.Stat(filepath.Join(root, "导出 + (新).assets", "image-1.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := p.createWordMarkdown(filepath.Join(root, "导出 + (新).md"), record.ID, "overwrite"); err == nil {
		t.Fatal("must not overwrite existing file")
	}
	after, _ := os.ReadFile(source)
	if string(after) != string(original) {
		t.Fatal("source Word was changed")
	}
	if err := p.drafts.delete(record.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.drafts.dir, record.ID+".assets")); !os.IsNotExist(err) {
		t.Fatal("discarded images were not removed")
	}
}

func TestWordExportCollisionAndImageScope(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "example.docx")
	writeWordFixture(t, source, wordFixtureParts())
	p, id := testWorkspace(t, root)
	p.drafts = &draftStore{dir: filepath.Join(root, "drafts")}
	result, pluginErr := p.importWordFile(source)
	if pluginErr != nil {
		t.Fatal(pluginErr.Message)
	}
	record := result.(map[string]any)["draft"].(draftRecord)
	if err := os.Mkdir(filepath.Join(root, "occupied.assets"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := p.createWordMarkdown(filepath.Join(root, "occupied.md"), record.ID, record.Content); err == nil {
		t.Fatal("must not merge with existing assets")
	}
	if _, err := os.Stat(filepath.Join(root, "occupied.md")); !os.IsNotExist(err) {
		t.Fatal("failed export left a partial Markdown file")
	}
	if _, pluginErr := p.create(createRequest{WorkspaceID: id, Path: "../outside.md", Kind: "file", DraftID: record.ID}); pluginErr == nil {
		t.Fatal("export escaped workspace")
	}
	for _, path := range []string{"../example.docx", "../../outside.png", "/tmp/outside.png"} {
		params, _ := json.Marshal(map[string]string{"id": record.ID, "path": path})
		if _, pluginErr := p.readImage(params, true); pluginErr == nil {
			t.Fatal("image escaped draft")
		}
	}
}

func TestWordRejectsMalformedAndOversizedInput(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"old.doc", "broken.docx"} {
		file := filepath.Join(root, name)
		os.WriteFile(file, []byte("not a Word document"), 0600)
		if _, _, _, err := convertWord(file, "test.assets"); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	file := filepath.Join(root, "large.docx")
	writeWordFixture(t, file, map[string]string{"word/document.xml": strings.Repeat("x", maxWordBytes+1)})
	if _, _, _, err := convertWord(file, "test.assets"); err == nil {
		t.Fatal("accepted oversized expanded document")
	}
	writeWordFixture(t, file, map[string]string{"word/document.xml": "<broken>"})
	if _, _, _, err := convertWord(file, "test.assets"); err == nil {
		t.Fatal("accepted malformed XML")
	}
}
