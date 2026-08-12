package music

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (function roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestYoutubeTransportIgnoresRateLimitFromSecondaryWatchPage(t *testing.T) {
	transport := youtubeTransport{
		base: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusFound,
				Header: http.Header{
					"Location": []string{"https://www.google.com/sorry/index?continue=youtube"},
				},
				Body:    io.NopCloser(strings.NewReader("rate limited")),
				Request: request,
			}, nil
		}),
	}

	request, err := http.NewRequest(http.MethodGet, "https://www.youtube.com/watch?v=test", nil)
	if err != nil {
		t.Fatal(err)
	}

	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "ytInitialPlayerResponse") {
		t.Fatal("fallback player response was not returned")
	}
}
