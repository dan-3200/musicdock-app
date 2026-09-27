package main

import (
	"embed"
	"log"

	"music-app/internal/handlers"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed all:img/*
var resources embed.FS

func main() {
	var mainWindow *application.WebviewWindow

	app := application.New(application.Options{
		Name:        "MusicDock",
		Description: "MusicDock desktop music player",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.daniel.musicdock",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if mainWindow != nil {
					mainWindow.Restore()
					mainWindow.Show().Focus()
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "main",
		Title:              "MusicDock Engine",
		Width:              480,
		Height:             480,
		Frameless:          true,
		DisableResize:      true,
		BackgroundType:     application.BackgroundTypeTransparent,
		BackgroundColour:   application.NewRGBA(40, 40, 43, 0),
		ZoomControlEnabled: false,
		URL:                "/",
		Windows: application.WindowsWindow{
			BackdropType:                      application.None,
			DisableFramelessWindowDecorations: true,
		},
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHidden,
			Backdrop: application.MacBackdropTransparent,
			Appearance: application.NSAppearanceNameDarkAqua,
		},
	})

	handler := handlers.NewHandler(app, mainWindow, resources)
	app.RegisterService(application.NewService(handler))

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
