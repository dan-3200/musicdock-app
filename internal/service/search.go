package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	searchRequestTimeout       = 10 * time.Second
	maxSearchResponseBytes     = 8 << 20
	maxSuggestionResponseBytes = 1 << 20
	maxVideoResults            = 20
	maxSearchSuggestions       = 8
)

var searchHTTPClient = &http.Client{Timeout: searchRequestTimeout}

type VideoResult struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Thumbnail string `json:"thumbnail"`
	Url       string `json:"url"`
}

func SearchVideos(query string) ([]VideoResult, error) {
	query = normalizeSearchQuery(query)
	if query == "" {
		return []VideoResult{}, nil
	}

	endpoint, err := url.Parse("https://www.youtube.com/results")
	if err != nil {
		return nil, err
	}
	params := endpoint.Query()
	params.Set("search_query", query)
	params.Set("sp", "EgIQAQ%3D%3D")
	endpoint.RawQuery = params.Encode()

	ctx, cancel := context.WithTimeout(context.Background(), searchRequestTimeout)
	defer cancel()

	req, err := newSearchRequest(ctx, endpoint.String())
	if err != nil {
		return nil, err
	}
	resp, err := searchHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("searching YouTube: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("YouTube search returned %s", resp.Status)
	}

	body, err := readLimitedBody(resp.Body, maxSearchResponseBytes)
	if err != nil {
		return nil, fmt.Errorf("reading YouTube search response: %w", err)
	}
	return parseSearchVideosPage(body)
}

func GetSearchSuggestions(query string) ([]string, error) {
	query = normalizeSearchQuery(query)
	if query == "" {
		return []string{}, nil
	}

	endpoint, err := url.Parse("https://suggestqueries.google.com/complete/search")
	if err != nil {
		return nil, err
	}
	params := endpoint.Query()
	params.Set("client", "firefox")
	params.Set("ds", "yt")
	params.Set("hl", "pt-BR")
	params.Set("q", query)
	endpoint.RawQuery = params.Encode()

	ctx, cancel := context.WithTimeout(context.Background(), searchRequestTimeout)
	defer cancel()

	req, err := newSearchRequest(ctx, endpoint.String())
	if err != nil {
		return nil, err
	}
	resp, err := searchHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("loading search suggestions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search suggestions returned %s", resp.Status)
	}
	body, err := readLimitedBody(resp.Body, maxSuggestionResponseBytes)
	if err != nil {
		return nil, fmt.Errorf("reading search suggestions: %w", err)
	}
	return parseSearchSuggestions(body, query)
}

func normalizeSearchQuery(query string) string {
	return strings.Join(strings.Fields(query), " ")
}

func newSearchRequest(ctx context.Context, endpoint string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/json;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.7")
	return req, nil
}

func readLimitedBody(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("response exceeded %d bytes", limit)
	}
	return body, nil
}

type youtubeText struct {
	SimpleText string `json:"simpleText"`
	Runs       []struct {
		Text string `json:"text"`
	} `json:"runs"`
}

func (text youtubeText) String() string {
	if text.SimpleText != "" {
		return strings.TrimSpace(html.UnescapeString(text.SimpleText))
	}

	var title strings.Builder
	for _, run := range text.Runs {
		title.WriteString(run.Text)
	}
	return strings.TrimSpace(html.UnescapeString(title.String()))
}

type youtubeVideoRenderer struct {
	VideoID   string      `json:"videoId"`
	Title     youtubeText `json:"title"`
	Thumbnail struct {
		Thumbnails []struct {
			URL string `json:"url"`
		} `json:"thumbnails"`
	} `json:"thumbnail"`
}

func parseSearchVideosPage(body []byte) ([]VideoResult, error) {
	initialData, err := extractYTInitialData(body)
	if err != nil {
		return nil, err
	}

	results := make([]VideoResult, 0, maxVideoResults)
	seen := make(map[string]struct{}, maxVideoResults)
	needle := []byte(`"videoRenderer"`)

	for offset := 0; offset < len(initialData) && len(results) < maxVideoResults; {
		match := bytes.Index(initialData[offset:], needle)
		if match < 0 {
			break
		}
		match += offset
		objectStart := bytes.IndexByte(initialData[match+len(needle):], '{')
		if objectStart < 0 {
			break
		}
		objectStart += match + len(needle)

		object, end, err := extractJSONObject(initialData, objectStart)
		if err != nil {
			offset = objectStart + 1
			continue
		}
		offset = end

		var renderer youtubeVideoRenderer
		if err := json.Unmarshal(object, &renderer); err != nil {
			continue
		}
		if !validYouTubeVideoID(renderer.VideoID) {
			continue
		}
		if _, exists := seen[renderer.VideoID]; exists {
			continue
		}

		title := renderer.Title.String()
		if title == "" {
			continue
		}
		seen[renderer.VideoID] = struct{}{}
		results = append(results, VideoResult{
			ID:        renderer.VideoID,
			Title:     title,
			Thumbnail: renderer.thumbnailURL(),
			Url:       "https://www.youtube.com/watch?v=" + renderer.VideoID,
		})
	}

	return results, nil
}

func (renderer youtubeVideoRenderer) thumbnailURL() string {
	for i := len(renderer.Thumbnail.Thumbnails) - 1; i >= 0; i-- {
		thumbnail := strings.TrimSpace(renderer.Thumbnail.Thumbnails[i].URL)
		if strings.HasPrefix(thumbnail, "//") {
			return "https:" + thumbnail
		}
		if strings.HasPrefix(thumbnail, "https://") {
			return thumbnail
		}
	}
	return fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", renderer.VideoID)
}

func validYouTubeVideoID(id string) bool {
	if len(id) != 11 {
		return false
	}
	for _, char := range id {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') &&
			(char < '0' || char > '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}

func extractYTInitialData(body []byte) ([]byte, error) {
	markers := [][]byte{
		[]byte("var ytInitialData"),
		[]byte("window[\"ytInitialData\"]"),
		[]byte("ytInitialData ="),
	}

	for _, marker := range markers {
		markerStart := bytes.Index(body, marker)
		if markerStart < 0 {
			continue
		}
		searchFrom := markerStart + len(marker)
		objectStart := bytes.IndexByte(body[searchFrom:], '{')
		if objectStart < 0 {
			continue
		}
		objectStart += searchFrom
		object, _, err := extractJSONObject(body, objectStart)
		if err == nil {
			return object, nil
		}
	}

	return nil, errors.New("could not find valid ytInitialData")
}

func extractJSONObject(data []byte, start int) ([]byte, int, error) {
	if start < 0 || start >= len(data) || data[start] != '{' {
		return nil, start, errors.New("JSON object does not start with an opening brace")
	}

	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(data); index++ {
		char := data[index]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if char == '\\' {
				escaped = true
				continue
			}
			if char == '"' {
				inString = false
			}
			continue
		}

		switch char {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return data[start : index+1], index + 1, nil
			}
		}
	}

	return nil, len(data), errors.New("unterminated JSON object")
}

func parseSearchSuggestions(body []byte, query string) ([]string, error) {
	var envelope []json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("decoding search suggestions: %w", err)
	}
	if len(envelope) < 2 {
		return []string{}, nil
	}

	var candidates []string
	if err := json.Unmarshal(envelope[1], &candidates); err != nil {
		return nil, fmt.Errorf("decoding suggestion list: %w", err)
	}

	capacity := len(candidates)
	if capacity > maxSearchSuggestions {
		capacity = maxSearchSuggestions
	}
	suggestions := make([]string, 0, capacity)
	seen := make(map[string]struct{}, len(candidates))
	normalizedQuery := strings.ToLower(normalizeSearchQuery(query))
	for _, candidate := range candidates {
		candidate = normalizeSearchQuery(candidate)
		key := strings.ToLower(candidate)
		if candidate == "" || key == normalizedQuery {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		suggestions = append(suggestions, candidate)
		if len(suggestions) == maxSearchSuggestions {
			break
		}
	}

	return suggestions, nil
}
