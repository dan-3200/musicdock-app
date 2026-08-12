package service

import (
	"context"
	"io"
	"music-app/internal/music"
	"os"
	"runtime/debug"
	"time"

	"github.com/hugolgst/rich-go/client"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func GetAudioUrl(url string) (string, error) {
	// Apenas resolve a URL, sem gerenciar bytes
	directUrl, err := music.YoutubeByUrl(url)
	if err != nil {
		return "", err
	}
	return directUrl, nil
}

func DownloadSong(url string, pathName string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream, err := music.YoutubeByStream(ctx, url)
	if err != nil {
		return err
	}
	defer stream.Close()

	file, err := os.Create(pathName)
	if err != nil {
		return err
	}
	defer file.Close()

	// 3. O io.Copy é perfeito aqui porque ele transfere os bytes
	// conforme eles chegam, sem carregar tudo na RAM (essencial para arquivos grandes)
	buf := make([]byte, 32*1024)
	_, err = io.CopyBuffer(file, stream, buf)
	if err != nil {
		return err
	}

	debug.FreeOSMemory()
	return nil
}

func SaveSongDialog(ctx context.Context, songName string) (string, error) {
	filepath, err := runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           "Salvar Música",
		DefaultFilename: songName + ".webm",
		Filters: []runtime.FileFilter{
			{DisplayName: "Audio Files (*.webm)", Pattern: "*.webm"},
		},
	})
	if err != nil {
		return "", err
	}

	return filepath, nil // Retorna o caminho escolhido (ex: C:\Musicas\teste.webm)
}

func SetDiscordPresence(details string, state string) error {
	start := time.Now()
	// O segredo está aqui: o tempo atual + a duração da música
	end := start.Add(time.Duration(199) * time.Second)

	err := client.SetActivity(client.Activity{
		State:      state,
		Details:    details,
		LargeImage: "embedded_background", // Nome da imagem enviada no painel do desenvolvedor
		SmallImage: "",
		LargeText:  "Meu App Wails",
		Timestamps: &client.Timestamps{
			Start: &start,
			End:   &end,
		},
		Buttons: []*client.Button{
			{
				Label: "Listen on MusicDock",
				Url:   "https://seu-site-ou-github.com",
			},
		},
	})
	if err != nil {
		return err
	}

	return nil
}
