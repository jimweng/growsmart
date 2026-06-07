package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jimweng/growsmart/internal/db"
	"github.com/jimweng/growsmart/internal/growth"
)

// Handler holds shared dependencies.
type Handler struct {
	db *db.DB
}

func New(database *db.DB) *Handler {
	return &Handler{db: database}
}

// Register wires all routes onto mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/children", h.children)
	mux.HandleFunc("/api/children/", h.childrenSub) // /:id and /:id/measurements/:mid
	mux.HandleFunc("/api/curves", h.handleCurves)
	mux.HandleFunc("/api/percentile", h.handlePercentile)
	mux.HandleFunc("/api/predict", h.handlePredict)
	mux.HandleFunc("/api/project", h.handleProject)
	mux.HandleFunc("/api/ai/ask", h.handleAskAI)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── /api/children ───────────────────────────────────────────────────────────

func (h *Handler) children(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := h.db.ListChildren()
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, list)

	case http.MethodPost:
		var req struct {
			Name         string   `json:"name"`
			Gender       string   `json:"gender"`
			BirthDate    string   `json:"birthDate"`
			FatherHeight *float64 `json:"fatherHeight"`
			MotherHeight *float64 `json:"motherHeight"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		if req.Name == "" || (req.Gender != "male" && req.Gender != "female") || req.BirthDate == "" {
			writeError(w, 400, "name, gender (male|female), birthDate required")
			return
		}
		c, err := h.db.CreateChild(req.Name, req.Gender, req.BirthDate, req.FatherHeight, req.MotherHeight)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 201, c)

	default:
		writeError(w, 405, "method not allowed")
	}
}

// ─── /api/children/:id  and  /api/children/:id/measurements[/:mid] ───────────

func (h *Handler) childrenSub(w http.ResponseWriter, r *http.Request) {
	// Strip leading /api/children/
	path := strings.TrimPrefix(r.URL.Path, "/api/children/")
	parts := strings.Split(strings.Trim(path, "/"), "/")

	if len(parts) == 0 || parts[0] == "" {
		writeError(w, 400, "missing child id")
		return
	}
	childID := parts[0]

	// /api/children/:id
	if len(parts) == 1 {
		h.childByID(w, r, childID)
		return
	}

	// /api/children/:id/measurements
	if parts[1] == "measurements" {
		if len(parts) == 2 {
			h.measurements(w, r, childID)
		} else {
			h.measurementByID(w, r, childID, parts[2])
		}
		return
	}

	// /api/children/:id/ai-history
	if parts[1] == "ai-history" {
		h.handleAIHistory(w, r, childID)
		return
	}

	writeError(w, 404, "not found")
}

func (h *Handler) childByID(w http.ResponseWriter, r *http.Request, childID string) {
	switch r.Method {
	case http.MethodPut:
		var req struct {
			Name         string   `json:"name"`
			Gender       string   `json:"gender"`
			BirthDate    string   `json:"birthDate"`
			FatherHeight *float64 `json:"fatherHeight"`
			MotherHeight *float64 `json:"motherHeight"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		c, err := h.db.UpdateChild(childID, req.Name, req.Gender, req.BirthDate, req.FatherHeight, req.MotherHeight)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, c)

	case http.MethodDelete:
		if err := h.db.DeleteChild(childID); err != nil {
			writeError(w, 404, err.Error())
			return
		}
		w.WriteHeader(204)

	default:
		writeError(w, 405, "method not allowed")
	}
}

func (h *Handler) measurements(w http.ResponseWriter, r *http.Request, childID string) {
	switch r.Method {
	case http.MethodGet:
		ms, err := h.db.ListMeasurements(childID)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, ms)

	case http.MethodPost:
		var req struct {
			Date   string   `json:"date"`
			Height *float64 `json:"height"`
			Weight *float64 `json:"weight"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		if req.Date == "" {
			writeError(w, 400, "date required")
			return
		}
		m, err := h.db.AddMeasurement(childID, req.Date, req.Height, req.Weight)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 201, m)

	default:
		writeError(w, 405, "method not allowed")
	}
}

func (h *Handler) measurementByID(w http.ResponseWriter, r *http.Request, childID, measureID string) {
	if r.Method != http.MethodDelete {
		writeError(w, 405, "method not allowed")
		return
	}
	if err := h.db.DeleteMeasurement(childID, measureID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	w.WriteHeader(204)
}

// ─── /api/curves ──────────────────────────────────────────────────────────────

func (h *Handler) handleCurves(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "GET only")
		return
	}
	q := r.URL.Query()
	gender := q.Get("gender")
	if gender != "male" && gender != "female" {
		writeError(w, 400, "gender must be male or female")
		return
	}
	measureType := q.Get("type")
	if measureType != "height" && measureType != "weight" {
		writeError(w, 400, "type must be height or weight")
		return
	}
	from, _ := strconv.Atoi(q.Get("from"))
	to, _ := strconv.Atoi(q.Get("to"))
	step, _ := strconv.Atoi(q.Get("step"))
	if to == 0 {
		to = 96
	}
	if step <= 0 {
		step = 3
	}
	curves := growth.CalcGrowthCurves(gender, measureType, from, to, step)
	writeJSON(w, 200, curves)
}

// ─── /api/percentile ─────────────────────────────────────────────────────────

func (h *Handler) handlePercentile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "POST only")
		return
	}
	var req struct {
		Gender    string  `json:"gender"`
		AgeMonths int     `json:"ageMonths"`
		Height    float64 `json:"height"`
		Weight    float64 `json:"weight"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	res := growth.CalcPercentile(req.Gender, req.AgeMonths, req.Height, req.Weight)
	writeJSON(w, 200, res)
}

// ─── /api/project ────────────────────────────────────────────────────────────

func (h *Handler) handleProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "POST only")
		return
	}
	var req struct {
		Gender      string  `json:"gender"`
		Type        string  `json:"type"`
		AgeMonths   int     `json:"ageMonths"`
		Value       float64 `json:"value"`
		PredictUpTo int     `json:"predictUpTo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if req.AgeMonths <= 0 || req.Value <= 0 {
		writeError(w, 400, "ageMonths and value required")
		return
	}
	if req.PredictUpTo == 0 {
		req.PredictUpTo = 216
	}
	res := growth.ProjectByZScore(req.Gender, req.Type, req.AgeMonths, req.Value, req.PredictUpTo)
	writeJSON(w, 200, res)
}

// ─── /api/predict ────────────────────────────────────────────────────────────

func (h *Handler) handlePredict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "POST only")
		return
	}
	var req struct {
		Points      []growth.DataPoint `json:"points"`
		PredictUpTo int                `json:"predictUpTo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if len(req.Points) < 2 {
		writeError(w, 400, "need at least 2 data points")
		return
	}
	if req.PredictUpTo == 0 {
		req.PredictUpTo = 216 // 18 years
	}
	writeJSON(w, 200, growth.Predict(req.Points, req.PredictUpTo))
}
