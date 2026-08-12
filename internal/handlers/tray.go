package handlers

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/getlantern/systray"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const settingsFileName = "settings.json"

type persistedSettings struct {
	TrayIconEnabled bool `json:"trayIconEnabled"`
}

type trayManager struct {
	mu          sync.RWMutex
	resources   embed.FS
	enabled     bool
	everStarted bool
	running     bool
}

func newTrayManager(resources embed.FS, enabled bool) *trayManager {
	return &trayManager{resources: resources, enabled: enabled}
}

func loadTrayPreference() bool {
	settings := persistedSettings{TrayIconEnabled: true}
	path, err := settingsPath()
	if err != nil {
		return settings.TrayIconEnabled
	}
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

func (manager *trayManager) StartIfEnabled(app *Handler) {
	manager.mu.RLock()
	enabled := manager.enabled
	manager.mu.RUnlock()
	if enabled {
		manager.start(app)
	}
}

func (manager *trayManager) SetEnabled(app *Handler, enabled bool) (bool, error) {
	if err := saveTrayPreference(enabled); err != nil {
		return false, err
	}

	manager.mu.Lock()
	manager.enabled = enabled
	running := manager.running
	everStarted := manager.everStarted
	if !enabled {
		manager.running = false
	}
	manager.mu.Unlock()

	if !enabled {
		if running {
			systray.Quit()
		}
		return false, nil
	}
	if !everStarted {
		manager.start(app)
		return false, nil
	}
	return !running, nil
}

func (manager *trayManager) start(app *Handler) {
	manager.mu.Lock()
	if manager.everStarted {
		manager.mu.Unlock()
		return
	}
	manager.everStarted = true
	manager.running = true
	manager.mu.Unlock()

	go systray.Run(manager.onReady(app), func() {
		manager.mu.Lock()
		manager.running = false
		manager.mu.Unlock()
	})
}

func (manager *trayManager) onReady(app *Handler) func() {
	return func() {
		iconPath := "img/appicon.png"
		if runtime.GOOS == "windows" {
			iconPath = "img/icon.ico"
		}
		iconBytes, _ := manager.resources.ReadFile(iconPath)
		systray.SetIcon(iconBytes)
		systray.SetTitle("MusicDock")
		systray.SetTooltip("MusicDock · clique para abrir")

		openItem := systray.AddMenuItem("Abrir MusicDock", "Mostra a janela")
		hideItem := systray.AddMenuItem("Esconder MusicDock", "Esconde a janela")
		quitItem := systray.AddMenuItem("Sair", "Fecha o MusicDock")

		for {
			select {
			case <-openItem.ClickedCh:
				wailsRuntime.WindowShow(app.ctx)
			case <-hideItem.ClickedCh:
				wailsRuntime.Hide(app.ctx)
			case <-quitItem.ClickedCh:
				wailsRuntime.Quit(app.ctx)
				return
			}
		}
	}
}
