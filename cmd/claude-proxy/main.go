// claude-proxy runs on the HOST and exposes a local HTTP endpoint that
// executes `claude --output-format text -p -` via stdin.
// The Go backend (running inside Docker) calls this proxy via
// http://host.docker.internal:9999 so it can use the local claude CLI
// without the binary needing to exist inside the container.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// ProxyRequest mirrors the payload sent by the Go backend.
type ProxyRequest struct {
	SystemPrompt string    `json:"systemPrompt"`
	Messages     []Message `json:"messages"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ProxyResponse struct {
	Answer string `json:"answer,omitempty"`
	Error  string `json:"error,omitempty"`
}

func findCLI() (string, error) {
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates := []string{
			filepath.Join(home, ".local", "bin", "claude"),
			filepath.Join(home, "bin", "claude"),
			"/usr/local/bin/claude",
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
	}
	return "", fmt.Errorf("claude CLI not found in PATH or common locations")
}

func buildPrompt(systemPrompt string, messages []Message) string {
	var sb strings.Builder
	sb.WriteString(systemPrompt)
	sb.WriteString("\n\n以下是對話記錄：\n")
	for _, m := range messages {
		label := "USER"
		if m.Role == "assistant" {
			label = "ASSISTANT"
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", label, m.Content))
	}
	if len(messages) > 0 && messages[len(messages)-1].Role != "assistant" {
		sb.WriteString("ASSISTANT:")
	}
	return sb.String()
}

func handleAsk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req ProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(req.Messages) == 0 {
		writeErr(w, http.StatusBadRequest, "messages required")
		return
	}

	cliPath, err := findCLI()
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	prompt := buildPrompt(req.SystemPrompt, req.Messages)

	ctx := r.Context()
	cmd := exec.CommandContext(ctx, cliPath, "--output-format", "text", "-p", "-")
	cmd.Stdin = strings.NewReader(prompt)

	out, execErr := cmd.Output()
	if execErr != nil {
		var exitErr *exec.ExitError
		if errors.As(execErr, &exitErr) {
			writeErr(w, http.StatusInternalServerError,
				fmt.Sprintf("claude exit %d: %s", exitErr.ExitCode(), string(exitErr.Stderr)))
			return
		}
		writeErr(w, http.StatusInternalServerError, execErr.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ProxyResponse{Answer: strings.TrimSpace(string(out))})
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ProxyResponse{Error: msg})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	cliPath, err := findCLI()
	status := map[string]string{"status": "ok", "cli": cliPath}
	if err != nil {
		status["status"] = "degraded"
		status["cli"] = err.Error()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func main() {
	port := os.Getenv("PROXY_PORT")
	if port == "" {
		port = "9999"
	}

	cliPath, err := findCLI()
	if err != nil {
		log.Fatalf("claude CLI not found: %v", err)
	}
	log.Printf("claude-proxy: using CLI at %s", cliPath)

	mux := http.NewServeMux()
	mux.HandleFunc("/ask", handleAsk)
	mux.HandleFunc("/health", handleHealth)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 120 * time.Second, // claude can be slow
	}

	go func() {
		log.Printf("claude-proxy listening on http://localhost:%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("proxy server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("claude-proxy shutting down")
}
