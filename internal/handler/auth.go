package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/jimweng/growsmart/internal/db"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type contextKey string

const userContextKey contextKey = "user"

func baseURL() string {
	if v := os.Getenv("BASE_URL"); v != "" {
		return v
	}
	return "http://localhost:8090"
}

func googleConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  baseURL() + "/auth/google/callback",
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

func facebookConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("FACEBOOK_CLIENT_ID"),
		ClientSecret: os.Getenv("FACEBOOK_CLIENT_SECRET"),
		RedirectURL:  baseURL() + "/auth/facebook/callback",
		Scopes:       []string{"email", "public_profile"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://www.facebook.com/v18.0/dialog/oauth",
			TokenURL: "https://graph.facebook.com/v18.0/oauth/access_token",
		},
	}
}

func lineConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("LINE_CLIENT_ID"),
		ClientSecret: os.Getenv("LINE_CLIENT_SECRET"),
		RedirectURL:  baseURL() + "/auth/line/callback",
		Scopes:       []string{"profile", "openid", "email"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://access.line.me/oauth2/v2.1/authorize",
			TokenURL: "https://api.line.me/oauth2/v2.1/token",
		},
	}
}

func randomState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// AuthMiddleware validates the session cookie and injects the user into context.
// Returns 401 if not authenticated.
func (h *Handler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("gs_session")
		if err != nil {
			writeError(w, 401, "unauthorized")
			return
		}
		user, err := h.db.GetSessionUser(cookie.Value)
		if err != nil {
			writeError(w, 401, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next(w, r.WithContext(ctx))
	}
}

func userFromCtx(r *http.Request) (db.User, bool) {
	u, ok := r.Context().Value(userContextKey).(db.User)
	return u, ok
}

// ─── /auth/me ────────────────────────────────────────────────────────────────

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("gs_session")
	if err != nil {
		writeError(w, 401, "unauthorized")
		return
	}
	user, err := h.db.GetSessionUser(cookie.Value)
	if err != nil {
		writeError(w, 401, "unauthorized")
		return
	}
	writeJSON(w, 200, user)
}

// ─── /auth/logout ────────────────────────────────────────────────────────────

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("gs_session")
	if err == nil {
		h.db.DeleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:    "gs_session",
		Value:   "",
		Path:    "/",
		Expires: time.Unix(0, 0),
		MaxAge:  -1,
	})
	http.Redirect(w, r, "/", http.StatusFound)
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

func (h *Handler) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	cfg := googleConfig()
	if cfg.ClientID == "" {
		writeError(w, 503, "Google OAuth not configured")
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     "gs_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, cfg.AuthCodeURL(state, oauth2.AccessTypeOnline), http.StatusFound)
}

func (h *Handler) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	cfg := googleConfig()
	stateCookie, err := r.Cookie("gs_oauth_state")
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		writeError(w, 400, "invalid OAuth state")
		return
	}
	token, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		writeError(w, 400, fmt.Sprintf("token exchange failed: %v", err))
		return
	}
	userInfo, err := fetchGoogleUserInfo(token.AccessToken)
	if err != nil {
		writeError(w, 500, "failed to fetch user info")
		return
	}
	h.finishLogin(w, r, "google", userInfo["id"], userInfo["email"], userInfo["name"], userInfo["picture"])
}

func fetchGoogleUserInfo(accessToken string) (map[string]string, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var data map[string]any
	json.Unmarshal(body, &data)
	get := func(k string) string {
		if v, ok := data[k]; ok {
			return fmt.Sprint(v)
		}
		return ""
	}
	return map[string]string{
		"id":      get("id"),
		"email":   get("email"),
		"name":    get("name"),
		"picture": get("picture"),
	}, nil
}

// ─── Facebook OAuth ───────────────────────────────────────────────────────────

func (h *Handler) handleFacebookLogin(w http.ResponseWriter, r *http.Request) {
	cfg := facebookConfig()
	if cfg.ClientID == "" {
		writeError(w, 503, "Facebook OAuth not configured")
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     "gs_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, cfg.AuthCodeURL(state, oauth2.AccessTypeOnline), http.StatusFound)
}

func (h *Handler) handleFacebookCallback(w http.ResponseWriter, r *http.Request) {
	cfg := facebookConfig()
	stateCookie, err := r.Cookie("gs_oauth_state")
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		writeError(w, 400, "invalid OAuth state")
		return
	}
	token, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		writeError(w, 400, fmt.Sprintf("token exchange failed: %v", err))
		return
	}
	userInfo, err := fetchFacebookUserInfo(token.AccessToken)
	if err != nil {
		writeError(w, 500, "failed to fetch user info")
		return
	}
	h.finishLogin(w, r, "facebook", userInfo["id"], userInfo["email"], userInfo["name"], userInfo["picture"])
}

func fetchFacebookUserInfo(accessToken string) (map[string]string, error) {
	url := "https://graph.facebook.com/me?fields=id,email,name,picture.type(large)&access_token=" + accessToken
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var data map[string]any
	json.Unmarshal(body, &data)
	get := func(k string) string {
		if v, ok := data[k]; ok {
			return fmt.Sprint(v)
		}
		return ""
	}
	picture := ""
	if pic, ok := data["picture"].(map[string]any); ok {
		if picData, ok := pic["data"].(map[string]any); ok {
			if url, ok := picData["url"].(string); ok {
				picture = url
			}
		}
	}
	return map[string]string{
		"id":      get("id"),
		"email":   get("email"),
		"name":    get("name"),
		"picture": picture,
	}, nil
}

// ─── LINE OAuth ───────────────────────────────────────────────────────────────

func (h *Handler) handleLineLogin(w http.ResponseWriter, r *http.Request) {
	cfg := lineConfig()
	if cfg.ClientID == "" {
		writeError(w, 503, "LINE OAuth not configured")
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     "gs_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, cfg.AuthCodeURL(state), http.StatusFound)
}

func (h *Handler) handleLineCallback(w http.ResponseWriter, r *http.Request) {
	cfg := lineConfig()
	stateCookie, err := r.Cookie("gs_oauth_state")
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		writeError(w, 400, "invalid OAuth state")
		return
	}
	token, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		writeError(w, 400, fmt.Sprintf("token exchange failed: %v", err))
		return
	}
	userInfo, err := fetchLINEUserInfo(token.AccessToken)
	if err != nil {
		writeError(w, 500, "failed to fetch user info")
		return
	}
	h.finishLogin(w, r, "line", userInfo["id"], userInfo["email"], userInfo["name"], userInfo["picture"])
}

func fetchLINEUserInfo(accessToken string) (map[string]string, error) {
	req, _ := http.NewRequest("GET", "https://api.line.me/v2/profile", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var data map[string]any
	json.Unmarshal(body, &data)
	get := func(k string) string {
		if v, ok := data[k]; ok {
			return fmt.Sprint(v)
		}
		return ""
	}
	return map[string]string{
		"id":      get("userId"),
		"email":   "",
		"name":    get("displayName"),
		"picture": get("pictureUrl"),
	}, nil
}

// ─── Shared login finisher ────────────────────────────────────────────────────

func (h *Handler) finishLogin(w http.ResponseWriter, r *http.Request, provider, providerID, email, name, avatarURL string) {
	user, err := h.db.UpsertUser(provider, providerID, email, name, avatarURL)
	if err != nil {
		writeError(w, 500, "failed to save user: "+err.Error())
		return
	}
	// Assign any pre-existing unowned children to this user (first-login migration)
	h.db.ClaimUnownedChildren(user.ID)

	token, err := h.db.CreateSession(user.ID)
	if err != nil {
		writeError(w, 500, "failed to create session")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "gs_session",
		Value:    token,
		Path:     "/",
		MaxAge:   30 * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:   "gs_oauth_state",
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})
	http.Redirect(w, r, "/", http.StatusFound)
}
