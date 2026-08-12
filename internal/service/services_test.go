package service

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseSearchVideosPage(t *testing.T) {
	body := []byte(`<html><script>
var ytInitialData = {
  "contents": [
    {"videoRenderer": {
      "videoId": "abcDEF123_-",
      "title": {"runs": [{"text": "Uma "}, {"text": "música &amp; vídeo"}]},
      "thumbnail": {"thumbnails": [{"url": "https://img.example/small.jpg"}, {"url": "//img.example/large.jpg"}]}
    }},
    {"nested": {"videoRenderer": {
      "videoId": "xyzABC987_-",
      "title": {"simpleText": "Segundo resultado"}
    }}},
    {"videoRenderer": {
      "videoId": "abcDEF123_-",
      "title": {"simpleText": "Duplicado"}
    }},
    {"videoRenderer": {
      "videoId": "inválido",
      "title": {"simpleText": "Ignorar"}
    }}
  ]
};
</script></html>`)

	results, err := parseSearchVideosPage(body)

	require.NoError(t, err)
	require.Equal(t, []VideoResult{
		{
			ID:        "abcDEF123_-",
			Title:     "Uma música & vídeo",
			Thumbnail: "https://img.example/large.jpg",
			Url:       "https://www.youtube.com/watch?v=abcDEF123_-",
		},
		{
			ID:        "xyzABC987_-",
			Title:     "Segundo resultado",
			Thumbnail: "https://i.ytimg.com/vi/xyzABC987_-/hqdefault.jpg",
			Url:       "https://www.youtube.com/watch?v=xyzABC987_-",
		},
	}, results)
}

func TestParseSearchVideosPageHandlesBracesInsideStrings(t *testing.T) {
	body := []byte(`<script>window["ytInitialData"] = {"contents":[{"videoRenderer":{"videoId":"abcDEF123_-","title":{"simpleText":"Faixa } especial"}}}]};</script>`)

	results, err := parseSearchVideosPage(body)

	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Equal(t, "Faixa } especial", results[0].Title)
}

func TestParseSearchVideosPageRejectsMissingInitialData(t *testing.T) {
	_, err := parseSearchVideosPage([]byte(`<html>sem dados</html>`))

	require.ErrorContains(t, err, "ytInitialData")
}

func TestParseSearchSuggestionsNormalizesDeduplicatesAndLimits(t *testing.T) {
	body := `[
      "funk",
      [" funk ", "FUNK MIX", "funk   mix", "funk antigo", "funk 2026", "funk remix", "funk playlist", "funk brasil", "funk novo", "funk hits", "funk extra"]
    ]`

	suggestions, err := parseSearchSuggestions([]byte(body), "  funk  ")

	require.NoError(t, err)
	require.Equal(t, []string{
		"FUNK MIX",
		"funk antigo",
		"funk 2026",
		"funk remix",
		"funk playlist",
		"funk brasil",
		"funk novo",
		"funk hits",
	}, suggestions)
}

func TestParseSearchSuggestionsDoesNotPanicOnUnexpectedPayload(t *testing.T) {
	_, err := parseSearchSuggestions([]byte(`["funk", {"unexpected": true}]`), "funk")

	require.ErrorContains(t, err, "suggestion list")
}

func TestNormalizeSearchQuery(t *testing.T) {
	require.Equal(t, "música para trabalhar", normalizeSearchQuery("  música\tpara\n trabalhar  "))
}

func TestReadLimitedBody(t *testing.T) {
	body, err := readLimitedBody(strings.NewReader("1234"), 4)
	require.NoError(t, err)
	require.Equal(t, "1234", string(body))

	_, err = readLimitedBody(strings.NewReader("12345"), 4)
	require.ErrorContains(t, err, "exceeded")
}

func TestSearchServicesLive(t *testing.T) {
	if os.Getenv("MUSICDOCK_LIVE_TESTS") == "" {
		t.Skip("set MUSICDOCK_LIVE_TESTS=1 to run integration tests")
	}

	videos, err := SearchVideos("música brasileira")
	require.NoError(t, err)
	require.NotEmpty(t, videos)

	suggestions, err := GetSearchSuggestions("música brasileira")
	require.NoError(t, err)
	require.NotEmpty(t, suggestions)
}
