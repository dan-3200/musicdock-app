package music

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"time"

	"github.com/kkdai/youtube/v2"
)

const youtubeRequestTimeout = 15 * time.Second

// youtubeTransport tolera o rate limit da página HTML secundária usada pela
// biblioteca apenas para preencher PublishDate. Os formatos de áudio já foram
// obtidos pela resposta Innertube nesse ponto, então uma falha em /watch não
// deve invalidar uma faixa que está pronta para tocar.
type youtubeTransport struct {
	base http.RoundTripper
}

func (transport youtubeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := transport.base.RoundTrip(request)
	if err != nil || response == nil {
		return response, err
	}

	isWatchPage := request.URL.Hostname() == "www.youtube.com" && request.URL.Path == "/watch"
	isRateLimitRedirect := response.StatusCode >= http.StatusMultipleChoices && response.StatusCode < http.StatusBadRequest &&
		strings.Contains(response.Header.Get("Location"), "google.com/sorry/")
	if isWatchPage && (response.StatusCode == http.StatusTooManyRequests || isRateLimitRedirect) {
		response.Body.Close()
		const fallbackPage = `<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"streamingData":{"formats":[{"itag":1,"url":"about:blank"}]}};</script>`

		return &http.Response{
			Status:        "200 OK",
			StatusCode:    http.StatusOK,
			Header:        make(http.Header),
			Body:          io.NopCloser(strings.NewReader(fallbackPage)),
			ContentLength: int64(len(fallbackPage)),
			Request:       request,
		}, nil
	}

	return response, nil
}

func newYoutubeClient() youtube.Client {
	return youtube.Client{
		HTTPClient: &http.Client{
			Timeout: youtubeRequestTimeout,
			Transport: youtubeTransport{
				base: http.DefaultTransport,
			},
		},
	}
}

// Baixar video localmente
func YoutubeByStream(ctx context.Context, url string) (io.ReadCloser, error) {
	client := newYoutubeClient()

	video, err := client.GetVideoContext(ctx, url)
	if err != nil {
		return nil, err
	}

	formats := video.Formats.WithAudioChannels().Type("audio")
	if len(formats) == 0 {
		return nil, fmt.Errorf("nenhum formato de áudio disponível")
	}

	stream, _, err := client.GetStreamContext(ctx, video, &formats[0])
	if err != nil {
		return nil, err
	}

	return stream, nil
}

// Execução do video no frontend
func YoutubeByUrl(url string) (string, error) {
	client := newYoutubeClient()

	ctx, cancel := context.WithTimeout(context.Background(), youtubeRequestTimeout)
	defer cancel()

	video, err := client.GetVideoContext(ctx, url)
	if err != nil {
		return "", err
	}
	formats := video.Formats.WithAudioChannels().Type("audio")
	if len(formats) == 0 {
		return "", fmt.Errorf("nenhum formato de áudio disponível")
	}

	url_youtube, err := client.GetStreamURLContext(ctx, video, &formats[0])
	if err != nil {
		return "", err
	}

	return url_youtube, err
}
