package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const maxDraftBytes = 1 << 20
const maxDraftJSONBytes = 1800000

type draftRecord struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Content      string `json:"content"`
	LanguageID   string `json:"languageId"`
	LanguageAuto bool   `json:"languageAuto"`
	Selection    int    `json:"selection"`
	ScrollTop    int    `json:"scrollTop"`
	UpdatedAt    int64  `json:"updatedAt"`
}

type draftStore struct {
	dir string
}

type editorPreferences struct {
	RecentFolders   []string       `json:"recentFolders"`
	RecentFiles     []string       `json:"recentFiles"`
	RecentPositions []filePosition `json:"recentPositions"`
	Session         editorSession  `json:"session"`
	Theme           string         `json:"theme"`
	EditorFont      string         `json:"editorFont"`
	EditorFontSize  float64        `json:"editorFontSize"`
}

type editorSession struct {
	WorkspacePath string   `json:"workspacePath"`
	SingleFile    bool     `json:"singleFile"`
	OpenFiles     []string `json:"openFiles"`
	ActiveFile    string   `json:"activeFile"`
	ActiveDraft   string   `json:"activeDraft"`
}

type filePosition struct {
	Path      string `json:"path"`
	Selection int    `json:"selection"`
	ScrollTop int    `json:"scrollTop"`
}

func newDraftStore() (*draftStore, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return &draftStore{dir: filepath.Join(base, "io.github.yuwengueen.dbx-code-editor", "drafts")}, nil
}

func validDraftID(id string) bool {
	if len(id) < 8 || len(id) > 80 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

func (s *draftStore) ensureDirectory() error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(s.dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("temporary draft directory is not a regular directory")
	}
	return os.Chmod(s.dir, 0700)
}

func (s *draftStore) draftPath(id string) (string, error) {
	if !validDraftID(id) {
		return "", errors.New("invalid temporary draft ID")
	}
	return filepath.Join(s.dir, id+".json"), nil
}

func (s *draftStore) save(record draftRecord) error {
	file, err := s.draftPath(record.ID)
	if err != nil {
		return err
	}
	if record.Name == "" || len(record.Name) > 255 || !utf8.ValidString(record.Name) || len(record.Content) > maxDraftBytes || !utf8.ValidString(record.Content) {
		return errors.New("temporary draft is invalid or too large")
	}
	if record.Selection < 0 || record.ScrollTop < 0 {
		return errors.New("invalid temporary draft position")
	}
	if err := s.ensureDirectory(); err != nil {
		return err
	}
	record.UpdatedAt = time.Now().UnixMilli()
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if len(data) > maxDraftJSONBytes {
		return errors.New("temporary draft is too large")
	}
	temp, err := os.CreateTemp(s.dir, ".draft-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), file)
}

func (s *draftStore) listIDs(after string) ([]string, string, error) {
	if after != "" && !validDraftID(after) {
		return nil, "", errors.New("invalid temporary draft cursor")
	}
	if err := s.ensureDirectory(); err != nil {
		return nil, "", err
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, "", err
	}
	ids := make([]string, 0)
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !strings.HasSuffix(entry.Name(), ".json") || !validDraftID(id) || id <= after {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() && info.Size() <= maxDraftJSONBytes {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) <= 100 {
		return ids, "", nil
	}
	return ids[:100], ids[99], nil
}

func (s *draftStore) read(id string) (draftRecord, error) {
	file, err := s.draftPath(id)
	if err != nil {
		return draftRecord{}, err
	}
	if err := s.ensureDirectory(); err != nil {
		return draftRecord{}, err
	}
	info, err := os.Lstat(file)
	if err != nil {
		return draftRecord{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxDraftJSONBytes {
		return draftRecord{}, errors.New("invalid temporary draft file")
	}
	contents, err := os.Open(file)
	if err != nil {
		return draftRecord{}, err
	}
	data, readErr := io.ReadAll(io.LimitReader(contents, maxDraftJSONBytes+1))
	closeErr := contents.Close()
	if readErr != nil {
		return draftRecord{}, readErr
	}
	if closeErr != nil {
		return draftRecord{}, closeErr
	}
	if len(data) > maxDraftJSONBytes {
		return draftRecord{}, errors.New("temporary draft is too large")
	}
	var record draftRecord
	if err := json.Unmarshal(data, &record); err != nil || record.ID != id {
		return draftRecord{}, errors.New("invalid temporary draft file")
	}
	return record, nil
}

func (s *draftStore) delete(id string) error {
	file, err := s.draftPath(id)
	if err != nil {
		return err
	}
	if err := s.ensureDirectory(); err != nil {
		return err
	}
	if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove temporary draft: %w", err)
	}
	return nil
}

func (s *draftStore) loadPreferences() (editorPreferences, error) {
	if err := s.ensureDirectory(); err != nil {
		return editorPreferences{}, err
	}
	file := filepath.Join(s.dir, ".preferences.json")
	info, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return editorPreferences{RecentFolders: []string{}, RecentFiles: []string{}, RecentPositions: []filePosition{}}, nil
	}
	if err != nil {
		return editorPreferences{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 65536 {
		return editorPreferences{}, errors.New("invalid editor preferences")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return editorPreferences{}, err
	}
	var preferences editorPreferences
	if err := json.Unmarshal(data, &preferences); err != nil {
		return editorPreferences{}, err
	}
	if preferences.RecentFolders == nil {
		preferences.RecentFolders = []string{}
	}
	if preferences.RecentFiles == nil {
		preferences.RecentFiles = []string{}
	}
	if preferences.RecentPositions == nil {
		preferences.RecentPositions = []filePosition{}
	}
	return preferences, nil
}

func (s *draftStore) savePreferences(preferences editorPreferences) error {
	if len(preferences.RecentFolders) > 8 || len(preferences.RecentFiles) > 8 || len(preferences.RecentPositions) > 20 || preferences.Theme != "dark" && preferences.Theme != "light" {
		return errors.New("invalid editor preferences")
	}
	switch preferences.EditorFont {
	case "", "default", "sf-mono", "menlo", "monaco", "andale-mono", "courier-new", "pt-mono", "songti-sc", "hiragino-sans-gb", "stheiti", "jetbrains-mono", "fira-code", "cascadia-code", "consolas", "noto-mono-cjk":
	default:
		return errors.New("invalid editor font")
	}
	if preferences.EditorFontSize != 0 && (preferences.EditorFontSize < 10 || preferences.EditorFontSize > 24) {
		return errors.New("invalid editor font size")
	}
	if preferences.Session.WorkspacePath != "" && (!filepath.IsAbs(preferences.Session.WorkspacePath) || len(preferences.Session.WorkspacePath) > 4096) {
		return errors.New("invalid session workspace")
	}
	if len(preferences.Session.OpenFiles) > 12 {
		return errors.New("too many session files")
	}
	if preferences.Session.ActiveDraft != "" && !validDraftID(preferences.Session.ActiveDraft) {
		return errors.New("invalid active draft")
	}
	for _, file := range append(append([]string{}, preferences.Session.OpenFiles...), preferences.Session.ActiveFile) {
		if file == "" {
			continue
		}
		clean := filepath.Clean(filepath.FromSlash(file))
		if preferences.Session.WorkspacePath == "" || filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || len(file) > 4096 {
			return errors.New("invalid session file")
		}
	}
	for _, folder := range preferences.RecentFolders {
		if !filepath.IsAbs(folder) || len(folder) > 4096 {
			return errors.New("invalid recent folder")
		}
	}
	for _, file := range preferences.RecentFiles {
		if !filepath.IsAbs(file) || len(file) > 4096 {
			return errors.New("invalid recent file")
		}
	}
	for _, position := range preferences.RecentPositions {
		if !filepath.IsAbs(position.Path) || len(position.Path) > 4096 || position.Selection < 0 || position.Selection > maxTextBytes || position.ScrollTop < 0 || position.ScrollTop > 1<<30 {
			return errors.New("invalid recent file position")
		}
	}
	if err := s.ensureDirectory(); err != nil {
		return err
	}
	data, err := json.Marshal(preferences)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(s.dir, ".preferences-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), filepath.Join(s.dir, ".preferences.json"))
}
