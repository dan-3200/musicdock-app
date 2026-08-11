package main

import (
	"embed"
	"music-app/internal/handlers"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed all:img/*
var recursos embed.FS

func main() {
	app := handlers.InitHandlers(recursos)
	app.StartTrayIfEnabled()

	err := wails.Run(&options.App{
		Title:           "MusicDock Engine",
		Width:           480,
		Height:          480,
		Frameless:       true,
		DisableResize:   true,
		CSSDragProperty: "--wails-draggable",
		CSSDragValue:    "drag",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "voss-musicdock-engine-123",
		},
		BackgroundColour: &options.RGBA{R: 40, G: 40, B: 43, A: 0},
		OnStartup:        app.Startup,
		OnShutdown:       app.Shutdown,
		Bind: []any{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               true,
			BackdropType:                      windows.None, // Fundamental para transparência total
			DisableFramelessWindowDecorations: true,         // ESTA é a chave para remover bordas nativas
			IsZoomControlEnabled:              false,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
			},
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
