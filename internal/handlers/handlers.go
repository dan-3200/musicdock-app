package handlers

import (
	"context"
	"embed"

	"music-app/internal/service"

	"github.com/hugolgst/rich-go/client"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Handler struct {
	app    *application.App
	window *application.WebviewWindow
	tray   *trayManager
}

func NewHandler(app *application.App, window *application.WebviewWindow, resources embed.FS) *Handler {
	handler := &Handler{app: app, window: window}
	handler.tray = newTrayManager(app, window, resources, loadTrayPreference())
	handler.tray.StartIfEnabled()
	return handler
}

func (handler *Handler) ServiceStartup(context.Context, application.ServiceOptions) error {
	return nil
}

func (handler *Handler) ServiceShutdown() error {
	client.Logout()
	return nil
}

func (handler *Handler) SaveSongDialog(songName string) (string, error) {
	dialog := handler.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:                "Salvar Música",
		Filename:             songName + ".webm",
		CanCreateDirectories: true,
		Window:               handler.window,
	})
	return dialog.AddFilter("Audio Files (*.webm)", "*.webm").PromptForSingleSelection()
}

func (handler *Handler) DownloadSong(url string, pathName string) error {
	return service.DownloadSong(url, pathName)
}

func (handler *Handler) GetAudioUrl(url string) (string, error) {
	return service.GetAudioUrl(url)
}

func (handler *Handler) GetSearchSuggestions(query string) ([]string, error) {
	return service.GetSearchSuggestions(query)
}

func (handler *Handler) SearchVideos(query string) ([]service.VideoResult, error) {
	return service.SearchVideos(query)
}

func (handler *Handler) GetTrayIconEnabled() bool {
	return handler.tray.Enabled()
}

func (handler *Handler) SetTrayIconEnabled(enabled bool) error {
	return handler.tray.SetEnabled(enabled)
}
