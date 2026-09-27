package handlers

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const settingsFileName = "settings.json"

type persistedSettings struct {
	TrayIconEnabled bool `json:"trayIconEnabled"`
}

type trayIcon interface {
	Show()
	Hide()
}

type trayManager struct {
	mu       sync.RWMutex
	enabled  bool
	tray     trayIcon
	newTray  func() trayIcon
	savePref func(bool) error
}

func newTrayManager(app *application.App, window *application.WebviewWindow, resources embed.FS, enabled bool) *trayManager {
	manager := &trayManager{enabled: enabled, savePref: saveTrayPreference}
	manager.newTray = func() trayIcon {
		tray := app.SystemTray.New()
		iconPath := "img/appicon.png"
		if runtime.GOOS == "windows" {
			iconPath = "img/icon.ico"
		}
		iconBytes, err := resources.ReadFile(iconPath)
		if err == nil {
			tray.SetIcon(iconBytes)
		}
		tray.SetTooltip("MusicDock · clique para abrir")

		menu := app.NewMenu()
		menu.Add("Abrir MusicDock").OnClick(func(*application.Context) {
			window.Show().Focus()
		})
		menu.Add("Esconder MusicDock").OnClick(func(*application.Context) {
			window.Hide()
		})
		menu.AddSeparator()
		menu.Add("Sair").OnClick(func(*application.Context) {
			app.Quit()
		})
		tray.SetMenu(menu)
		tray.OnClick(func() {
			if window.IsVisible() {
				window.Hide()
				return
			}
			window.Show().Focus()
		})
		return tray
	}
	return manager
}

func loadTrayPreference() bool {
	path, err := settingsPath()
	if err != nil {
		return true
	}
	return loadTrayPreferenceAt(path)
}

func loadTrayPreferenceAt(path string) bool {
	settings := persistedSettings{TrayIconEnabled: true}
	data, err := os.ReadFile(path)
	if err != nil {
		return settings.TrayIconEnabled
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return true
	}
	return settings.TrayIconEnabled
}

func saveTrayPreference(enabled bool) error {
	path, err := settingsPath()
	if err != nil {
		return err
	}
	return saveTrayPreferenceAt(path, enabled)
}

func saveTrayPreferenceAt(path string, enabled bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(persistedSettings{TrayIconEnabled: enabled}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func settingsPath() (string, error) {
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(directory, "MusicDock", settingsFileName), nil
}

func (manager *trayManager) Enabled() bool {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	return manager.enabled
}

func (manager *trayManager) StartIfEnabled() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.enabled {
		manager.showLocked()
	}
}

func (manager *trayManager) SetEnabled(enabled bool) error {
	if err := manager.savePref(enabled); err != nil {
		return err
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.enabled = enabled
	if enabled {
		manager.showLocked()
		return nil
	}
	if manager.tray != nil {
		manager.tray.Hide()
	}
	return nil
}

func (manager *trayManager) showLocked() {
	if manager.tray == nil {
		manager.tray = manager.newTray()
		return
	}
	manager.tray.Show()
}
