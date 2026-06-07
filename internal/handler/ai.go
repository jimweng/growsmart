package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jimweng/growsmart/internal/ai"
	"github.com/jimweng/growsmart/internal/growth"
)

// POST /api/ai/ask
// Body: { "childId": "uuid", "question": "string" }
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

	// Prompt injection guard
	if !ai.IsSafeQuestion(question) {
		writeError(w, 400, "question contains invalid content")
		return
	}

	// Load child
	child, err := h.db.GetChild(req.ChildID)
	if err != nil {
		writeError(w, 404, "child not found")
		return
	}

	// Load measurements to get latest values + percentiles
	measurements, err := h.db.ListMeasurements(req.ChildID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Build AI context
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
			h := 0.0
			if latest.HeightCm != nil {
				h = *latest.HeightCm
			}
			wt := 0.0
			if latest.WeightKg != nil {
				wt = *latest.WeightKg
			}
			pct := growth.CalcPercentile(child.Gender, latestAge, h, wt)
			if latest.HeightCm != nil {
				ctx.HeightPct = &pct.HeightPercentile
			}
			if latest.WeightKg != nil {
				ctx.WeightPct = &pct.WeightPercentile
			}
		}
	}

	answer, err := ai.Ask(ctx, question)
	if err != nil {
		writeError(w, 500, "AI service error: "+err.Error())
		return
	}

	writeJSON(w, 200, map[string]string{"answer": answer})
}

// ageInMonths computes current age from a YYYY-MM-DD birth date string.
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

// ageAtDateStr computes age in months at a specific measurement date.
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
