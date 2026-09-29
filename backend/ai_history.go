package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"sort"

	dbxpluginsdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

type aiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type aiSession struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Messages  []aiMessage     `json:"messages,omitempty"`
	State     json.RawMessage `json:"state,omitempty"`
	UpdatedAt int64           `json:"updatedAt"`
}

// Store conversations outside the repository, scoped to the canonical project root.
// Reuse the atomic, private-file draft storage implementation in a separate namespace.
func (p *plugin) aiHistory(method string, params json.RawMessage) (any, *dbxpluginsdk.PluginError) {
	var r struct {
		WorkspaceID string    `json:"workspaceId"`
		Session     aiSession `json:"session"`
		ID          string    `json:"id"`
	}
	if json.Unmarshal(params, &r) != nil {
		return nil, invalidRequest("Invalid history request")
	}
	scope, e := p.rootFor(r.WorkspaceID)
	if e != nil {
		return nil, e
	}
	if p.drafts == nil {
		return nil, invalidRequest("History storage unavailable")
	}
	p.historyMu.Lock()
	defer p.historyMu.Unlock()
	hash := sha256.Sum256([]byte(scope.root + "\x00" + scope.file))
	base := &draftStore{dir: filepath.Join(filepath.Dir(p.drafts.dir), "ai-history")}
	if err := base.ensureDirectory(); err != nil {
		return nil, internalError(err)
	}
	store := &draftStore{dir: filepath.Join(base.dir, hex.EncodeToString(hash[:]))}
	switch method {
	case "ai/history/save":
		if len(r.Session.Messages) > 2000 {
			return nil, invalidRequest("会话过长，请新建会话；已有历史仍然保留。")
		}
		for _, m := range r.Session.Messages {
			if m.Role != "user" && m.Role != "assistant" && m.Role != "tool" {
				return nil, invalidRequest("Invalid message role")
			}
		}
		data, err := json.Marshal(struct {
			Messages []aiMessage     `json:"messages"`
			State    json.RawMessage `json:"state,omitempty"`
		}{r.Session.Messages, r.Session.State})
		if err != nil {
			return nil, internalError(err)
		}
		if len(data) > maxDraftBytes {
			return nil, invalidRequest("会话超过 1 MiB，请新建会话；已有历史仍然保留。")
		}
		err = store.save(draftRecord{ID: r.Session.ID, Name: r.Session.Title, Content: string(data)})
		if err != nil {
			return nil, internalError(err)
		}
		return map[string]bool{"saved": true}, nil
	case "ai/history/read":
		record, err := store.read(r.ID)
		if err != nil {
			return nil, internalError(err)
		}
		session := aiSession{ID: record.ID, Title: record.Name, UpdatedAt: record.UpdatedAt}
		var stored struct {
			Messages []aiMessage     `json:"messages"`
			State    json.RawMessage `json:"state,omitempty"`
		}
		data := []byte(record.Content)
		if len(data) > 0 && data[0] == '[' {
			if err := json.Unmarshal(data, &stored.Messages); err != nil {
				return nil, internalError(err)
			}
		} else if json.Unmarshal(data, &stored) != nil {
			return nil, internalError(errors.New("会话历史已损坏"))
		}
		session.Messages = stored.Messages
		session.State = stored.State
		return session, nil
	case "ai/history/delete":
		if err := store.delete(r.ID); err != nil {
			return nil, internalError(err)
		}
		return map[string]bool{"deleted": true}, nil
	case "ai/history/list":
		sessions := []aiSession{}
		after := ""
		for {
			ids, next, err := store.listIDs(after)
			if err != nil {
				return nil, internalError(err)
			}
			for _, id := range ids {
				record, err := store.read(id)
				if err != nil {
					return nil, internalError(err)
				}
				sessions = append(sessions, aiSession{ID: record.ID, Title: record.Name, UpdatedAt: record.UpdatedAt})
			}
			if next == "" {
				break
			}
			after = next
		}
		sort.Slice(sessions, func(i, j int) bool { return sessions[i].UpdatedAt > sessions[j].UpdatedAt })
		return sessions, nil
	}
	return nil, invalidRequest("Unknown history operation")
}
