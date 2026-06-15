package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jimweng/growsmart/internal/ai"
	"github.com/jimweng/growsmart/internal/growth"
)

const aiHistoryWindow = 10 // sliding window for AI context

// POST /api/ai/ask
// Body: { "childId": "uuid", "question": "string" }
// Returns: { "answer": "string" }
func (h *Handler) handleAskAI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "POST only")
		return
	}

	var req struct {
		ChildID  string `json:"childId"`
		Question string `json:"question"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	question := strings.TrimSpace(req.Question)
	if len(question) < 5 {
		writeError(w, 400, "question too short")
		return
	}
	if len([]rune(question)) > 300 {
		writeError(w, 400, "question too long (max 300 characters)")
		return
	}
	if !ai.IsSafeQuestion(question) {
		writeError(w, 400, "question contains invalid content")
		return
	}

	user, _ := userFromCtx(r)
	child, err := h.db.GetChild(req.ChildID, user.ID)
	if err != nil {
		writeError(w, 404, "child not found")
		return
	}

	measurements, err := h.db.ListMeasurements(req.ChildID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	ctx := ai.ChildContext{
		Name:         child.Name,
		Gender:       child.Gender,
		AgeMonths:    ageInMonths(child.BirthDate),
		MeasureCount: len(measurements),
	}

	if len(measurements) > 0 {
		latest := measurements[len(measurements)-1]
		ctx.LatestHeight = latest.HeightCm
		ctx.LatestWeight = latest.WeightKg

		if latest.HeightCm != nil || latest.WeightKg != nil {
			latestAge := ageAtDateStr(child.BirthDate, latest.MeasureDate)
			hv := 0.0
			if latest.HeightCm != nil {
				hv = *latest.HeightCm
			}
			wv := 0.0
			if latest.WeightKg != nil {
				wv = *latest.WeightKg
			}
			pct := growth.CalcPercentile(child.Gender, latestAge, hv, wv)
			if latest.HeightCm != nil {
				ctx.HeightPct = &pct.HeightPercentile
			}
			if latest.WeightKg != nil {
				ctx.WeightPct = &pct.WeightPercentile
			}
		}
	}

	// Load history from DB (source of truth); use last N as context window.
	dbMsgs, err := h.db.ListAIConversation(req.ChildID)
	if err != nil {
		writeError(w, 500, "load history: "+err.Error())
		return
	}
	history := make([]ai.Message, 0, len(dbMsgs))
	for _, m := range dbMsgs {
		history = append(history, ai.Message{Role: m.Role, Content: m.Content})
	}
	if len(history) > aiHistoryWindow {
		history = history[len(history)-aiHistoryWindow:]
	}

	answer, err := ai.Ask(r.Context(), ctx, history, question)
	if err != nil {
		writeError(w, 500, "AI error: "+err.Error())
		return
	}

	// Persist both turns.
	if saveErr := h.db.SaveAIMessage(req.ChildID, "user", question); saveErr != nil {
		writeError(w, 500, "save user message: "+saveErr.Error())
		return
	}
	if saveErr := h.db.SaveAIMessage(req.ChildID, "assistant", answer); saveErr != nil {
		writeError(w, 500, "save assistant message: "+saveErr.Error())
		return
	}

	writeJSON(w, 200, map[string]string{"answer": answer})
}

// GET  /api/children/:id/ai-history — return full conversation history
// DELETE /api/children/:id/ai-history — clear conversation history
func (h *Handler) handleAIHistory(w http.ResponseWriter, r *http.Request, childID string) {
	switch r.Method {
	case http.MethodGet:
		msgs, err := h.db.ListAIConversation(childID)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, msgs)

	case http.MethodDelete:
		if err := h.db.ClearAIConversation(childID); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		w.WriteHeader(204)

	default:
		writeError(w, 405, "method not allowed")
	}
}

func ageInMonths(birthDate string) int {
	bd, err := time.Parse("2006-01-02", birthDate)
	if err != nil {
		return 0
	}
	now := time.Now()
	months := (now.Year()-bd.Year())*12 + int(now.Month()) - int(bd.Month())
	if now.Day() < bd.Day() {
		months--
	}
	return months
}

func ageAtDateStr(birthDate, measureDate string) int {
	bd, err1 := time.Parse("2006-01-02", birthDate)
	md, err2 := time.Parse("2006-01-02", measureDate)
	if err1 != nil || err2 != nil {
		return 0
	}
	months := (md.Year()-bd.Year())*12 + int(md.Month()) - int(bd.Month())
	if md.Day() < bd.Day() {
		months--
	}
	return months
}
