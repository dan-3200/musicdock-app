package handlers

import (
	"context"
	"embed"

	// "fmt"

	"music-app/internal/service"

	"github.com/hugolgst/rich-go/client"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Handler struct {
	ctx  context.Context
	tray *trayManager
}

func InitHandlers(resources embed.FS) *Handler {
	return &Handler{tray: newTrayManager(resources, loadTrayPreference())}
}

func (it *Handler) Startup(ctx context.Context) {
	it.ctx = ctx
	// err := client.Login("")
	// if err != nil {
	// 	fmt.Println("Discord não encontrado ou fechado:", err)
	// 	return
	// }

	// err = service.SetDiscordPresence("Ouvindo Musga", "Musiga Boa")
	// if err != nil {
	// 	fmt.Println("Erro ao ativar presença inicial:", err)
	// }
}

func (a *Handler) Shutdown(ctx context.Context) {
	client.Logout()
}

func (it *Handler) CloseWindow() {
	runtime.Quit(it.ctx)
}

func (it *Handler) SaveSongDialog(songName string) (string, error) {
	return service.SaveSongDialog(it.ctx, songName)
}

func (it *Handler) DownloadSong(url string, pathName string) error {
	return service.DownloadSong(url, pathName)
}

func (it *Handler) GetAudioUrl(url string) (string, error) {
	return service.GetAudioUrl(url)
}

func (it *Handler) GetSearchSuggestions(query string) ([]string, error) {
	return service.GetSearchSuggestions(query)
}

func (it *Handler) SearchVideos(query string) ([]service.VideoResult, error) {
	return service.SearchVideos(query)
}

func (it *Handler) StartTrayIfEnabled() {
	it.tray.StartIfEnabled(it)
}

func (it *Handler) GetTrayIconEnabled() bool {
	return it.tray.Enabled()
}

// SetTrayIconEnabled retorna true quando a preferência foi salva, mas o ícone
// só poderá ser restaurado no próximo início do app.
func (it *Handler) SetTrayIconEnabled(enabled bool) (bool, error) {
	return it.tray.SetEnabled(it, enabled)
}

// func (it *Handler) SetDiscordPresence(details string, state string) error {
// 	return service.SetDiscordPresence(details, state)
// }
