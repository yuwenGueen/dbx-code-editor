package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const maxWordBytes = 16 << 20
const maxWordExpandedBytes = 64 << 20
const maxWordImageBytes = 2 << 20

type wordImportInfo struct {
	AssetFolder string `json:"assetFolder"`
	ImageCount  int    `json:"imageCount"`
}

type wordNode struct {
	name     string
	attrs    map[string]string
	text     string
	children []*wordNode
}

func parseWordXML(data []byte) (*wordNode, error) {
	root := &wordNode{}
	stack := []*wordNode{root}
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	count := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch item := token.(type) {
		case xml.StartElement:
			count++
			if count > 250000 || len(stack) > 128 {
				return nil, errors.New("Word document is too complex")
			}
			node := &wordNode{name: item.Name.Local, attrs: map[string]string{}}
			for _, attr := range item.Attr {
				node.attrs[attr.Name.Local] = attr.Value
			}
			parent := stack[len(stack)-1]
			parent.children = append(parent.children, node)
			stack = append(stack, node)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			stack[len(stack)-1].text += string(item)
		}
	}
	return root, nil
}

func (n *wordNode) child(name string) *wordNode {
	if n != nil {
		for _, c := range n.children {
			if c.name == name {
				return c
			}
		}
	}
	return nil
}
func (n *wordNode) attr(name string) string {
	if n == nil {
		return ""
	}
	return n.attrs[name]
}
func (n *wordNode) descendants(name string) []*wordNode {
	var result []*wordNode
	if n == nil {
		return result
	}
	for _, c := range n.children {
		if c.name == name {
			result = append(result, c)
		} else {
			result = append(result, c.descendants(name)...)
		}
	}
	return result
}

type wordConverter struct {
	files        map[string]*zip.File
	rels         map[string]*wordNode
	styles       map[string]*wordNode
	numbers      map[string]*wordNode
	abstract     map[string]*wordNode
	counters     map[string]int
	images       map[string][]byte
	imageTargets map[string]string
	assetFolder  string
	warnings     int
}

func (c *wordConverter) read(name string) ([]byte, error) {
	file := c.files[name]
	if file == nil {
		return nil, os.ErrNotExist
	}
	r, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, maxWordBytes+1))
	if len(data) > maxWordBytes {
		return nil, errors.New("Word document entry is too large")
	}
	return data, err
}

func convertWord(file, assetFolder string) (string, map[string][]byte, int, error) {
	info, err := os.Stat(file)
	if err != nil {
		return "", nil, 0, err
	}
	if !strings.EqualFold(filepath.Ext(file), ".docx") {
		return "", nil, 0, errors.New("Only .docx is supported; save older .doc files as .docx first")
	}
	if info.Size() > maxWordBytes {
		return "", nil, 0, errors.New("Word file exceeds 16 MiB")
	}
	archive, err := zip.OpenReader(file)
	if err != nil {
		return "", nil, 0, errors.New("Cannot read this Word file; it may be damaged or password protected")
	}
	defer archive.Close()
	c := &wordConverter{files: map[string]*zip.File{}, rels: map[string]*wordNode{}, styles: map[string]*wordNode{}, numbers: map[string]*wordNode{}, abstract: map[string]*wordNode{}, counters: map[string]int{}, images: map[string][]byte{}, imageTargets: map[string]string{}, assetFolder: assetFolder}
	var expanded uint64
	if len(archive.File) > 4096 {
		return "", nil, 0, errors.New("Too many entries in Word document")
	}
	for _, f := range archive.File {
		if f.UncompressedSize64 > maxWordBytes {
			return "", nil, 0, errors.New("Word document entry is too large")
		}
		expanded += f.UncompressedSize64
		if expanded > maxWordExpandedBytes {
			return "", nil, 0, errors.New("Expanded Word document exceeds 64 MiB")
		}
		if c.files[f.Name] != nil {
			return "", nil, 0, errors.New("Duplicate Word document entry")
		}
		c.files[f.Name] = f
	}
	for _, part := range []string{"word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml"} {
		data, err := c.read(part)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", nil, 0, err
		}
		node, err := parseWordXML(data)
		if err != nil {
			return "", nil, 0, err
		}
		for _, rel := range node.descendants("Relationship") {
			c.rels[rel.attr("Id")] = rel
		}
		for _, style := range node.descendants("style") {
			c.styles[style.attr("styleId")] = style
		}
		for _, num := range node.descendants("num") {
			c.numbers[num.attr("numId")] = num
		}
		for _, num := range node.descendants("abstractNum") {
			c.abstract[num.attr("abstractNumId")] = num
		}
	}
	data, err := c.read("word/document.xml")
	if err != nil {
		return "", nil, 0, errors.New("Word document body is missing")
	}
	doc, err := parseWordXML(data)
	if err != nil {
		return "", nil, 0, err
	}
	body := doc.child("document").child("body")
	if body == nil {
		return "", nil, 0, errors.New("Word document body is missing")
	}
	content := strings.TrimSpace(c.blocks(body)) + "\n"
	if len(content) > maxDraftBytes {
		return "", nil, 0, errors.New("Converted Markdown exceeds the 1 MiB draft limit")
	}
	return content, c.images, c.warnings, nil
}

var headingStyle = regexp.MustCompile(`(?i)^(?:heading|标题)\s*([1-6])$`)
var markdownEscape = strings.NewReplacer("\\", "\\\\", "`", "\\`", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]", "<", "&lt;", ">", "&gt;")

func (c *wordConverter) heading(props *wordNode) int {
	if level, err := strconv.Atoi(props.child("outlineLvl").attr("val")); err == nil && level >= 0 && level < 6 {
		return level + 1
	}
	id := props.child("pStyle").attr("val")
	for depth := 0; id != "" && depth < 16; depth++ {
		style := c.styles[id]
		name := style.child("name").attr("val")
		for _, value := range []string{id, name} {
			if match := headingStyle.FindStringSubmatch(value); len(match) > 1 {
				level, _ := strconv.Atoi(match[1])
				return level
			}
		}
		if level, err := strconv.Atoi(style.child("pPr").child("outlineLvl").attr("val")); err == nil && level >= 0 && level < 6 {
			return level + 1
		}
		id = style.child("basedOn").attr("val")
	}
	return 0
}

func (c *wordConverter) numbering(props *wordNode) *wordNode {
	if direct := props.child("numPr"); direct != nil {
		return direct
	}
	id := props.child("pStyle").attr("val")
	for depth := 0; id != "" && depth < 16; depth++ {
		style := c.styles[id]
		if num := style.child("pPr").child("numPr"); num != nil {
			return num
		}
		id = style.child("basedOn").attr("val")
	}
	return nil
}

func (c *wordConverter) blocks(node *wordNode) string {
	var out strings.Builder
	for _, n := range node.children {
		switch n.name {
		case "p":
			text := strings.TrimSpace(c.inline(n))
			if text == "" {
				continue
			}
			props := n.child("pPr")
			if heading := c.heading(props); heading > 0 {
				text = strings.Repeat("#", heading) + " " + text
			} else if num := c.numbering(props); num != nil && num.child("numId").attr("val") != "0" {
				level, _ := strconv.Atoi(num.child("ilvl").attr("val"))
				if level < 0 {
					level = 0
				}
				if level > 8 {
					level = 8
				}
				id := num.child("numId").attr("val")
				for deeper := level + 1; deeper <= 8; deeper++ {
					delete(c.counters, id+":"+strconv.Itoa(deeper))
				}
				abstract := c.abstract[c.numbers[id].child("abstractNumId").attr("val")]
				prefix := "- "
				for _, def := range abstract.descendants("lvl") {
					if def.attr("ilvl") == strconv.Itoa(level) && def.child("numFmt").attr("val") != "bullet" {
						key := id + ":" + strconv.Itoa(level)
						if c.counters[key] == 0 {
							start, _ := strconv.Atoi(def.child("start").attr("val"))
							for _, override := range c.numbers[id].descendants("lvlOverride") {
								if override.attr("ilvl") == strconv.Itoa(level) && override.child("startOverride") != nil {
									start, _ = strconv.Atoi(override.child("startOverride").attr("val"))
								}
							}
							if start < 1 {
								start = 1
							}
							c.counters[key] = start
						}
						prefix = strconv.Itoa(c.counters[key]) + ". "
						c.counters[key]++
					}
				}
				text = strings.Repeat("    ", level) + prefix + text
			} else if strings.HasPrefix(text, "#") || strings.HasPrefix(text, "- ") || strings.HasPrefix(text, "+ ") {
				text = "\\" + text
			}
			out.WriteString(text + "\n\n")
		case "tbl":
			out.WriteString(c.table(n) + "\n\n")
		case "sdt", "sdtContent", "ins":
			out.WriteString(c.blocks(n))
		}
	}
	return out.String()
}

func enabled(n *wordNode) bool {
	return n != nil && n.attr("val") != "0" && n.attr("val") != "false" && n.attr("val") != "off"
}
func (c *wordConverter) inline(n *wordNode) string {
	if n == nil {
		return ""
	}
	switch n.name {
	case "t":
		return markdownEscape.Replace(n.text)
	case "tab":
		return "    "
	case "br", "cr":
		return "  \n"
	case "del", "pPr", "rPr", "instrText":
		return ""
	case "drawing", "pict":
		return c.image(n)
	case "oMath", "oMathPara":
		c.warnings++
		return "[公式]"
	}
	var out strings.Builder
	for _, child := range n.children {
		out.WriteString(c.inline(child))
	}
	text := out.String()
	if n.name == "r" && strings.TrimSpace(text) != "" {
		props := n.child("rPr")
		core := strings.TrimSpace(text)
		before, after := text[:len(text)-len(strings.TrimLeft(text, " \t\n"))], text[len(strings.TrimRight(text, " \t\n")):]
		if enabled(props.child("b")) {
			core = "**" + core + "**"
		}
		if enabled(props.child("i")) {
			core = "*" + core + "*"
		}
		if enabled(props.child("strike")) {
			core = "~~" + core + "~~"
		}
		text = before + core + after
	}
	if n.name == "hyperlink" {
		target := c.rels[n.attr("id")].attr("Target")
		if anchor := n.attr("anchor"); anchor != "" {
			target = "#" + anchor
		}
		parsed, err := url.Parse(target)
		if err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http" || parsed.Scheme == "mailto" || strings.HasPrefix(target, "#")) {
			return "[" + text + "](" + strings.NewReplacer(" ", "%20", "(", "%28", ")", "%29").Replace(target) + ")"
		}
	}
	return text
}

func (c *wordConverter) table(n *wordNode) string {
	var rows [][]string
	width := 0
	for _, row := range n.children {
		if row.name != "tr" {
			continue
		}
		var cells []string
		for _, cell := range row.children {
			if cell.name != "tc" {
				continue
			}
			text := strings.TrimSpace(c.blocks(cell))
			text = strings.ReplaceAll(strings.ReplaceAll(text, "|", "\\|"), "\n", "<br>")
			cells = append(cells, text)
		}
		if len(cells) > width {
			width = len(cells)
		}
		rows = append(rows, cells)
	}
	if width == 0 {
		return ""
	}
	var lines []string
	for i, row := range rows {
		for len(row) < width {
			row = append(row, "")
		}
		lines = append(lines, "| "+strings.Join(row, " | ")+" |")
		if i == 0 {
			lines = append(lines, "|"+strings.Repeat(" --- |", width))
		}
	}
	return strings.Join(lines, "\n")
}

func (c *wordConverter) image(n *wordNode) string {
	var references []string
	for _, blip := range n.descendants("blip") {
		references = append(references, blip.attr("embed"))
	}
	for _, data := range n.descendants("imagedata") {
		references = append(references, data.attr("id"))
	}
	if len(references) == 0 {
		c.warnings++
		return "[图片未转换]"
	}
	var result []string
	for _, id := range references {
		rel := c.rels[id]
		target := path.Clean(path.Join("word", rel.attr("Target")))
		if rel.attr("TargetMode") == "External" || !strings.HasPrefix(target, "word/media/") {
			c.warnings++
			continue
		}
		name := c.imageTargets[target]
		if name == "" {
			data, err := c.read(target)
			if err != nil || len(data) > maxWordImageBytes || len(c.images) >= 100 {
				c.warnings++
				result = append(result, "[图片未转换]")
				continue
			}
			ext := imageExtension(data)
			if ext == "" {
				c.warnings++
				result = append(result, "[不支持的图片格式]")
				continue
			}
			name = fmt.Sprintf("image-%d%s", len(c.images)+1, ext)
			c.imageTargets[target], c.images[name] = name, data
		}
		result = append(result, "!["+name+"]("+wordAssetURL(c.assetFolder)+"/"+name+")")
	}
	return strings.Join(result, "\n\n")
}

func imageExtension(data []byte) string {
	switch http.DetectContentType(data) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	}
	return ""
}

func wordAssetURL(folder string) string {
	return strings.ReplaceAll(url.QueryEscape(folder), "+", "%20")
}

func (s *draftStore) assetDirectory(id string) (string, error) {
	if !validDraftID(id) {
		return "", errors.New("Invalid draft ID")
	}
	dir := filepath.Join(s.dir, id+".assets")
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("Imported images are unavailable")
	}
	return canonicalDirectory(dir)
}

func (p *plugin) importWord() (any, *dbxpluginsdk.PluginError) {
	selected, pluginErr := nativePicker("word")
	if pluginErr != nil {
		return nil, pluginErr
	}
	choice, ok := selected.(map[string]string)
	if !ok || choice["path"] == "" {
		return selected, nil
	}
	return p.importWordFile(choice["path"])
}

func (p *plugin) importWordFile(source string) (any, *dbxpluginsdk.PluginError) {
	file, err := canonicalFile(source)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	if len(stem) > 180 {
		return nil, invalidRequest("Word filename is too long; shorten it before importing")
	}
	id, err := newToken()
	if err != nil {
		return nil, internalError(err)
	}
	content, images, warnings, err := convertWord(file, stem+".assets")
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	record := draftRecord{ID: id, Name: stem + ".md", Content: content, LanguageID: "Markdown", WordImport: &wordImportInfo{AssetFolder: stem + ".assets", ImageCount: len(images)}}
	if err := p.drafts.ensureDirectory(); err != nil {
		return nil, internalError(err)
	}
	dir := filepath.Join(p.drafts.dir, id+".assets")
	if len(images) > 0 {
		if err := os.Mkdir(dir, 0700); err != nil {
			return nil, internalError(err)
		}
		for name, data := range images {
			if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
				os.RemoveAll(dir)
				return nil, internalError(err)
			}
		}
	}
	if err := p.drafts.save(record); err != nil {
		os.RemoveAll(dir)
		return nil, internalError(err)
	}
	return map[string]any{"draft": record, "warnings": warnings}, nil
}

func (p *plugin) readImage(params json.RawMessage, draft bool) (any, *dbxpluginsdk.PluginError) {
	var request struct {
		ID          string `json:"id"`
		WorkspaceID string `json:"workspaceId"`
		Path        string `json:"path"`
	}
	if json.Unmarshal(params, &request) != nil {
		return nil, invalidRequest("Invalid image request")
	}
	var file string
	if draft {
		if !validDraftID(request.ID) || filepath.Base(request.Path) != request.Path || strings.ContainsAny(request.Path, "\\/") {
			return nil, invalidRequest("Invalid image path")
		}
		root, err := p.drafts.assetDirectory(request.ID)
		if err != nil {
			return nil, invalidRequest("Image is unavailable")
		}
		var pluginErr *dbxpluginsdk.PluginError
		file, pluginErr = resolvePath(root, request.Path)
		if pluginErr != nil {
			return nil, pluginErr
		}
	} else {
		var pluginErr *dbxpluginsdk.PluginError
		file, pluginErr = p.fileFor(workspaceRequest{WorkspaceID: request.WorkspaceID, Path: request.Path})
		if pluginErr != nil {
			return nil, pluginErr
		}
	}
	data, err := readSmallImage(file)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	return map[string]string{"url": "data:" + http.DetectContentType(data) + ";base64," + base64.StdEncoding.EncodeToString(data)}, nil
}

func readSmallImage(file string) ([]byte, error) {
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxWordImageBytes {
		return nil, errors.New("Image is missing or exceeds 2 MiB")
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxWordImageBytes+1))
	if err != nil || len(data) > maxWordImageBytes || imageExtension(data) == "" {
		return nil, errors.New("Unsupported image")
	}
	return data, nil
}

// The destination has already been checked against the workspace scope by create.
func (p *plugin) createWordMarkdown(file, draftID, content string) (string, error) {
	record, err := p.drafts.read(draftID)
	if err != nil || record.WordImport == nil {
		return "", errors.New("Imported draft is unavailable")
	}
	if !strings.EqualFold(filepath.Ext(file), ".md") {
		return "", errors.New("Save the imported document with a .md extension")
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return "", errors.New("A file with this name already exists, or the folder is not writable")
	}
	success := false
	createdDir := ""
	defer func() {
		f.Close()
		if !success {
			os.Remove(file)
			if createdDir != "" {
				os.RemoveAll(createdDir)
			}
		}
	}()
	if record.WordImport.ImageCount > 0 {
		folder := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file)) + ".assets"
		dir := filepath.Join(filepath.Dir(file), folder)
		if err := os.Mkdir(dir, 0755); err != nil {
			return "", errors.New("The image folder already exists; choose another Markdown name")
		}
		createdDir = dir
		source, err := p.drafts.assetDirectory(draftID)
		if err != nil {
			return "", errors.New("Imported images are unavailable")
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return "", err
		}
		if len(entries) != record.WordImport.ImageCount {
			return "", errors.New("Some imported images are missing")
		}
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
				return "", errors.New("Invalid imported image")
			}
			data, err := readSmallImage(filepath.Join(source, entry.Name()))
			if err != nil {
				return "", err
			}
			if err := os.WriteFile(filepath.Join(dir, entry.Name()), data, 0644); err != nil {
				return "", err
			}
		}
		content = strings.ReplaceAll(content, "]("+wordAssetURL(record.WordImport.AssetFolder)+"/", "]("+wordAssetURL(folder)+"/")
	}
	if _, err := io.WriteString(f, content); err != nil {
		return "", err
	}
	if err := f.Sync(); err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	success = true
	return content, nil
}
