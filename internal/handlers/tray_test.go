package handlers

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type fakeTray struct {
	showCalls int
	hideCalls int
}

func (tray *fakeTray) Show() { tray.showCalls++ }
func (tray *fakeTray) Hide() { tray.hideCalls++ }

func TestTrayPreferenceDefaultsToEnabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.json")
	if !loadTrayPreferenceAt(path) {
		t.Fatal("expected a missing preference to enable the tray")
	}
}

func TestTrayPreferenceDefaultsToEnabledWhenInvalid(t *testing.T) {
	path := filepath.Join(t.TempDir(), settingsFileName)
	if err := os.WriteFile(path, []byte("not-json"), 0o600); err != nil {
		t.Fatalf("write invalid preference: %v", err)
	}
	if !loadTrayPreferenceAt(path) {
		t.Fatal("expected an invalid preference to enable the tray")
	}
}

func TestTrayPreferenceRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "MusicDock", settingsFileName)
	if err := saveTrayPreferenceAt(path, false); err != nil {
		t.Fatalf("save preference: %v", err)
	}
	if loadTrayPreferenceAt(path) {
		t.Fatal("expected the saved disabled preference")
	}

	if err := saveTrayPreferenceAt(path, true); err != nil {
		t.Fatalf("update preference: %v", err)
	}
	if !loadTrayPreferenceAt(path) {
		t.Fatal("expected the saved enabled preference")
	}
}

func TestSaveTrayPreferenceReportsFilesystemError(t *testing.T) {
	parentFile := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(parentFile, []byte("file"), 0o600); err != nil {
		t.Fatalf("create parent file: %v", err)
	}
	if err := saveTrayPreferenceAt(filepath.Join(parentFile, settingsFileName), true); err == nil {
		t.Fatal("expected an error when the parent path is a file")
	}
}

func TestTrayCanBeDisabledAndReenabledWithoutRestart(t *testing.T) {
	tray := &fakeTray{}
	created := 0
	manager := &trayManager{
		enabled: true,
		newTray: func() trayIcon {
			created++
			return tray
		},
		savePref: func(bool) error { return nil },
	}

	manager.StartIfEnabled()
	if created != 1 {
		t.Fatalf("expected one tray, got %d", created)
	}
	if err := manager.SetEnabled(false); err != nil {
		t.Fatalf("disable tray: %v", err)
	}
	if err := manager.SetEnabled(true); err != nil {
		t.Fatalf("reenable tray: %v", err)
	}

	if created != 1 || tray.hideCalls != 1 || tray.showCalls != 1 {
		t.Fatalf("unexpected lifecycle: created=%d hide=%d show=%d", created, tray.hideCalls, tray.showCalls)
	}
}

func TestTrayStateDoesNotChangeWhenPersistenceFails(t *testing.T) {
	manager := &trayManager{
		enabled:  true,
		newTray:  func() trayIcon { return &fakeTray{} },
		savePref: func(bool) error { return errors.New("disk unavailable") },
	}

	if err := manager.SetEnabled(false); err == nil {
		t.Fatal("expected persistence error")
	}
	if !manager.Enabled() {
		t.Fatal("expected state to remain enabled")
	}
}
