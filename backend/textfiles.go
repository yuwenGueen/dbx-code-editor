package main

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

const maxTextBytes = 64 << 20
const inlineTextBytes = 512 << 10
const chunkTextBytes = 256 << 10

type readSession struct {
	workspaceID string
	chunks      []string
	expires     time.Time
}

type writeSession struct {
	workspaceID string
	path        string
	revision    string
	encoding    string
	content     []byte
	expires     time.Time
}

func newToken() (string, error) {
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return "", err
	}
	return hex.EncodeToString(token), nil
}

func textEncoding(name string) encoding.Encoding {
	switch name {
	case "gb18030":
		return simplifiedchinese.GB18030
	case "big5":
		return traditionalchinese.Big5
	case "shift_jis":
		return japanese.ShiftJIS
	case "euc-kr":
		return korean.EUCKR
	case "windows-1252":
		return charmap.Windows1252
	default:
		return nil
	}
}

func decodeUTF16(raw []byte, order binary.ByteOrder) (string, error) {
	if len(raw)%2 != 0 {
		return "", errors.New("Invalid UTF-16 byte count")
	}
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = order.Uint16(raw[i*2:])
	}
	decoded := string(utf16.Decode(units))
	if strings.ContainsRune(decoded, utf8.RuneError) && !bytes.Equal(encodeUTF16(decoded, order), raw) {
		return "", errors.New("Invalid UTF-16 sequence")
	}
	return decoded, nil
}

func encodeUTF16(content string, order binary.ByteOrder) []byte {
	units := utf16.Encode([]rune(content))
	raw := make([]byte, len(units)*2)
	for i, unit := range units {
		order.PutUint16(raw[i*2:], unit)
	}
	return raw
}

func plausibleText(content string) bool {
	if strings.ContainsRune(content, 0) {
		return false
	}
	controls, count := 0, 0
	for _, r := range content {
		count++
		if r < 32 && r != '\n' && r != '\r' && r != '\t' && r != '\f' {
			controls++
		}
	}
	return controls == 0 || controls*100 < count
}

func decodeLegacy(raw []byte, name string) (string, error) {
	codec := textEncoding(name)
	if codec == nil {
		return "", fmt.Errorf("Unsupported encoding: %s", name)
	}
	decoded, err := codec.NewDecoder().Bytes(raw)
	if err != nil {
		return "", err
	}
	text := string(decoded)
	if !utf8.ValidString(text) || !plausibleText(text) {
		return "", errors.New("File does not appear to be text in this encoding")
	}
	return text, nil
}

func decodeText(raw []byte, requested string) (string, string, error) {
	if requested == "" {
		switch {
		case bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}):
			requested = "utf-8-bom"
		case bytes.HasPrefix(raw, []byte{0xff, 0xfe}):
			requested = "utf-16le"
		case bytes.HasPrefix(raw, []byte{0xfe, 0xff}):
			requested = "utf-16be"
		case utf8.Valid(raw) && !bytes.Contains(raw, []byte{0}):
			requested = "utf-8"
		default:
			if len(raw) >= 4 {
				zerosEven, zerosOdd := 0, 0
				limit := len(raw)
				if limit > 4096 {
					limit = 4096
				}
				for i := 0; i < limit; i++ {
					if raw[i] == 0 {
						if i%2 == 0 {
							zerosEven++
						} else {
							zerosOdd++
						}
					}
				}
				if zerosOdd*5 > limit {
					requested = "utf-16le"
				} else if zerosEven*5 > limit {
					requested = "utf-16be"
				}
			}
			if requested == "" {
				for _, candidate := range []string{"gb18030", "big5", "shift_jis", "euc-kr", "windows-1252"} {
					text, err := decodeLegacy(raw, candidate)
					if err != nil {
						continue
					}
					back, err := textEncoding(candidate).NewEncoder().Bytes([]byte(text))
					if err == nil && bytes.Equal(back, raw) {
						return text, candidate, nil
					}
				}
				return "", "", errors.New("Could not detect text encoding; choose an encoding manually")
			}
		}
	}
	var content string
	switch requested {
	case "utf-8", "utf-8-bom":
		if requested == "utf-8-bom" && bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
			raw = raw[3:]
		}
		if !utf8.Valid(raw) {
			return "", "", errors.New("File is not valid UTF-8")
		}
		content = string(raw)
	case "utf-16le", "utf-16be":
		var order binary.ByteOrder = binary.LittleEndian
		if requested == "utf-16be" {
			order = binary.BigEndian
		}
		if requested == "utf-16le" && bytes.HasPrefix(raw, []byte{0xff, 0xfe}) {
			raw = raw[2:]
		}
		if requested == "utf-16be" && bytes.HasPrefix(raw, []byte{0xfe, 0xff}) {
			raw = raw[2:]
		}
		var err error
		content, err = decodeUTF16(raw, order)
		if err != nil {
			return "", "", err
		}
	default:
		var err error
		content, err = decodeLegacy(raw, requested)
		if err != nil {
			return "", "", err
		}
	}
	if !plausibleText(content) {
		return "", "", errors.New("File appears to be binary or uses another encoding")
	}
	if len(content) > maxTextBytes {
		return "", "", errors.New("Decoded text exceeds 64 MiB editor limit")
	}
	return content, requested, nil
}

func encodeText(content, name string, original []byte) ([]byte, error) {
	if !utf8.ValidString(content) || !plausibleText(content) {
		return nil, errors.New("Invalid text contents")
	}
	switch name {
	case "utf-8":
		return []byte(content), nil
	case "utf-8-bom":
		return append([]byte{0xef, 0xbb, 0xbf}, []byte(content)...), nil
	case "utf-16le", "utf-16be":
		var order binary.ByteOrder = binary.LittleEndian
		bom := []byte{0xff, 0xfe}
		if name == "utf-16be" {
			order, bom = binary.BigEndian, []byte{0xfe, 0xff}
		}
		encoded := encodeUTF16(content, order)
		if bytes.HasPrefix(original, bom) {
			return append(bom, encoded...), nil
		}
		return encoded, nil
	default:
		codec := textEncoding(name)
		if codec == nil {
			return nil, fmt.Errorf("Unsupported encoding: %s", name)
		}
		encoded, err := codec.NewEncoder().Bytes([]byte(content))
		if err != nil {
			return nil, fmt.Errorf("Text contains characters unavailable in %s: %w", name, err)
		}
		return encoded, nil
	}
}

func splitText(content string) []string {
	chunks := make([]string, 0, len(content)/chunkTextBytes+1)
	for len(content) > 0 {
		end := len(content)
		if end > chunkTextBytes {
			end = chunkTextBytes
		}
		for end < len(content) && !utf8.RuneStart(content[end]) {
			end--
		}
		chunks = append(chunks, content[:end])
		content = content[end:]
	}
	return chunks
}

func (p *plugin) readText(request workspaceRequest) (any, *dbxpluginsdk.PluginError) {
	file, pluginErr := p.fileFor(request)
	if pluginErr != nil {
		return nil, pluginErr
	}
	info, err := os.Stat(file)
	if err != nil {
		return nil, internalError(err)
	}
	if !info.Mode().IsRegular() {
		return nil, invalidRequest("Only regular files can be opened")
	}
	if info.Size() > maxFileBytes {
		return nil, invalidRequest("File exceeds the 32 MiB editor limit")
	}
	handle, err := os.Open(file)
	if err != nil {
		return nil, internalError(err)
	}
	defer handle.Close()
	raw, err := io.ReadAll(io.LimitReader(handle, maxFileBytes+1))
	if err != nil {
		return nil, internalError(err)
	}
	if len(raw) > maxFileBytes {
		return nil, invalidRequest("File exceeds the 32 MiB editor limit")
	}
	content, name, err := decodeText(raw, request.Encoding)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	result := map[string]any{"revision": revision(raw), "encoding": name}
	if len(content) <= inlineTextBytes {
		result["content"] = content
		return result, nil
	}
	id, err := newToken()
	if err != nil {
		return nil, internalError(err)
	}
	chunks := splitText(content)
	p.mu.Lock()
	if p.reads == nil {
		p.reads = make(map[string]readSession)
	}
	for key, session := range p.reads {
		if time.Now().After(session.expires) {
			delete(p.reads, key)
		}
	}
	if len(p.reads) >= 4 {
		p.mu.Unlock()
		return nil, invalidRequest("Too many files are loading; try again")
	}
	p.reads[id] = readSession{workspaceID: request.WorkspaceID, chunks: chunks, expires: time.Now().Add(5 * time.Minute)}
	p.mu.Unlock()
	result["readId"] = id
	result["chunks"] = len(chunks)
	return result, nil
}

func (p *plugin) readChunk(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
		ReadID      string `json:"readId"`
		Index       int    `json:"index"`
	}
	if json.Unmarshal(params, &request) != nil {
		return nil, invalidRequest("Invalid read request")
	}
	p.mu.RLock()
	session, ok := p.reads[request.ReadID]
	p.mu.RUnlock()
	if !ok || session.workspaceID != request.WorkspaceID || time.Now().After(session.expires) || request.Index < 0 || request.Index >= len(session.chunks) {
		return nil, invalidRequest("Read session expired; open the file again")
	}
	return map[string]any{"content": session.chunks[request.Index]}, nil
}

func (p *plugin) readEnd(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
		ReadID      string `json:"readId"`
	}
	if json.Unmarshal(params, &request) != nil {
		return nil, invalidRequest("Invalid read session")
	}
	p.mu.Lock()
	if p.reads[request.ReadID].workspaceID == request.WorkspaceID {
		delete(p.reads, request.ReadID)
	}
	p.mu.Unlock()
	return map[string]bool{"closed": true}, nil
}

func (p *plugin) saveText(request saveRequest) (any, *dbxpluginsdk.PluginError) {
	if request.ExpectedRevision == "" || len(request.Content) > maxTextBytes || !utf8.ValidString(request.Content) || !plausibleText(request.Content) {
		return nil, invalidRequest("Invalid file contents or revision")
	}
	file, pluginErr := p.fileFor(workspaceRequest{WorkspaceID: request.WorkspaceID, Path: request.Path})
	if pluginErr != nil {
		return nil, pluginErr
	}
	info, err := os.Stat(file)
	if err != nil {
		return nil, internalError(err)
	}
	if !info.Mode().IsRegular() {
		return nil, invalidRequest("Only regular files can be saved")
	}
	if info.Size() > maxFileBytes {
		return nil, invalidRequest("File exceeds the 32 MiB editor limit")
	}
	current, err := os.ReadFile(file)
	if err != nil {
		return nil, internalError(err)
	}
	if revision(current) != request.ExpectedRevision {
		return nil, dbxpluginsdk.NewError(-32009, "File changed outside Code Editor. Reload it before saving")
	}
	name := request.Encoding
	if name == "" {
		_, name, err = decodeText(current, "")
		if err != nil {
			return nil, invalidRequest(err.Error())
		}
	}
	encoded, err := encodeText(request.Content, name, current)
	if err != nil {
		return nil, invalidRequest(err.Error())
	}
	if len(encoded) > maxFileBytes {
		return nil, invalidRequest("Saved file would exceed the 32 MiB editor limit")
	}
	return writeFileAtomically(file, info, encoded)
}

func (p *plugin) saveStart(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var request saveRequest
	if json.Unmarshal(params, &request) != nil || request.ExpectedRevision == "" {
		return nil, invalidRequest("Invalid save request")
	}
	file, pluginErr := p.fileFor(workspaceRequest{WorkspaceID: request.WorkspaceID, Path: request.Path})
	if pluginErr != nil {
		return nil, pluginErr
	}
	info, err := os.Stat(file)
	if err != nil {
		return nil, internalError(err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxFileBytes {
		return nil, invalidRequest("Only regular files up to 32 MiB can be saved")
	}
	current, err := os.ReadFile(file)
	if err != nil {
		return nil, internalError(err)
	}
	if revision(current) != request.ExpectedRevision {
		return nil, dbxpluginsdk.NewError(-32009, "File changed outside Code Editor. Reload it before saving")
	}
	id, err := newToken()
	if err != nil {
		return nil, internalError(err)
	}
	p.mu.Lock()
	if p.writes == nil {
		p.writes = make(map[string]*writeSession)
	}
	for key, session := range p.writes {
		if time.Now().After(session.expires) {
			delete(p.writes, key)
		}
	}
	if len(p.writes) >= 4 {
		p.mu.Unlock()
		return nil, invalidRequest("Too many saves are pending; try again")
	}
	p.writes[id] = &writeSession{workspaceID: request.WorkspaceID, path: request.Path, revision: request.ExpectedRevision, encoding: request.Encoding, expires: time.Now().Add(5 * time.Minute)}
	p.mu.Unlock()
	return map[string]string{"saveId": id}, nil
}

func (p *plugin) saveChunk(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
		SaveID      string `json:"saveId"`
		Content     string `json:"content"`
	}
	if json.Unmarshal(params, &request) != nil || len(request.Content) > chunkTextBytes || !utf8.ValidString(request.Content) {
		return nil, invalidRequest("Invalid save chunk")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	session, ok := p.writes[request.SaveID]
	if !ok || session.workspaceID != request.WorkspaceID || time.Now().After(session.expires) {
		return nil, invalidRequest("Save session expired; try again")
	}
	if len(session.content)+len(request.Content) > maxTextBytes {
		return nil, invalidRequest("Text exceeds the 64 MiB editor limit")
	}
	session.content = append(session.content, request.Content...)
	return map[string]bool{"received": true}, nil
}

func (p *plugin) saveCommit(params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
		SaveID      string `json:"saveId"`
	}
	if json.Unmarshal(params, &request) != nil {
		return nil, invalidRequest("Invalid save session")
	}
	p.mu.Lock()
	session, ok := p.writes[request.SaveID]
	if ok && session.workspaceID == request.WorkspaceID {
		delete(p.writes, request.SaveID)
	}
	p.mu.Unlock()
	if !ok || session.workspaceID != request.WorkspaceID || time.Now().After(session.expires) {
		return nil, invalidRequest("Save session expired; try again")
	}
	return p.saveText(saveRequest{WorkspaceID: session.workspaceID, Path: session.path, Content: string(session.content), ExpectedRevision: session.revision, Encoding: session.encoding})
}
