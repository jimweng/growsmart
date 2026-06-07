package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/lib/pq"
)

// DB wraps the connection pool.
type DB struct {
	pool *sql.DB
}

// Child represents a child record.
type Child struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Gender       string   `json:"gender"`
	BirthDate    string   `json:"birthDate"` // YYYY-MM-DD
	FatherHeight *float64 `json:"fatherHeight"`
	MotherHeight *float64 `json:"motherHeight"`
}

// Measurement represents a single measurement record.
type Measurement struct {
	ID          string   `json:"id"`
	ChildID     string   `json:"childId"`
	MeasureDate string   `json:"date"` // YYYY-MM-DD
	HeightCm    *float64 `json:"height"`
	WeightKg    *float64 `json:"weight"`
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Connect opens and verifies a PostgreSQL connection.
func Connect() (*DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
			getenv("DB_HOST", "localhost"),
			getenv("DB_PORT", "5432"),
			getenv("DB_USER", "growsmart"),
			getenv("DB_PASSWORD", "growsmart"),
			getenv("DB_NAME", "growsmart"),
		)
	}
	pool, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := pool.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &DB{pool: pool}, nil
}

// Migrate creates tables if they don't exist.
// Each statement is a separate Exec so errors surface individually.
func (d *DB) Migrate() error {
	stmts := []string{
		`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
		`CREATE TABLE IF NOT EXISTS children (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name       TEXT NOT NULL,
			gender     TEXT NOT NULL CHECK (gender IN ('male','female')),
			birth_date DATE NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS measurements (
			id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			child_id     UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
			measure_date DATE NOT NULL,
			height_cm    NUMERIC(5,1),
			weight_kg    NUMERIC(5,2),
			created_at   TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (child_id, measure_date)
		)`,
		`CREATE TABLE IF NOT EXISTS ai_conversations (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			child_id   UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
			role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
			content    TEXT NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`ALTER TABLE children ADD COLUMN IF NOT EXISTS father_height NUMERIC(5,1)`,
		`ALTER TABLE children ADD COLUMN IF NOT EXISTS mother_height NUMERIC(5,1)`,
	}
	for _, s := range stmts {
		if _, err := d.pool.Exec(s); err != nil {
			return fmt.Errorf("migrate %q: %w", s[:min(len(s), 40)], err)
		}
	}
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ─── AI Conversations ──────────────────────────────────────────────────────────

// ConversationMessage is a single AI chat turn stored in the DB.
type ConversationMessage struct {
	ID        string `json:"id"`
	ChildID   string `json:"childId"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

func (d *DB) SaveAIMessage(childID, role, content string) error {
	_, err := d.pool.Exec(
		`INSERT INTO ai_conversations (child_id, role, content) VALUES ($1,$2,$3)`,
		childID, role, content,
	)
	return err
}

// ListAIConversation returns all messages for a child, oldest first.
func (d *DB) ListAIConversation(childID string) ([]ConversationMessage, error) {
	rows, err := d.pool.Query(
		`SELECT id, child_id, role, content, TO_CHAR(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM ai_conversations WHERE child_id=$1 ORDER BY created_at`,
		childID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []ConversationMessage
	for rows.Next() {
		var m ConversationMessage
		if err := rows.Scan(&m.ID, &m.ChildID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	if msgs == nil {
		msgs = []ConversationMessage{}
	}
	return msgs, nil
}

func (d *DB) ClearAIConversation(childID string) error {
	_, err := d.pool.Exec(`DELETE FROM ai_conversations WHERE child_id=$1`, childID)
	return err
}

// ─── Children ────────────────────────────────────────────────────────────────

const childSelect = `id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD'), father_height, mother_height`

func scanChild(row interface{ Scan(...any) error }) (Child, error) {
	var c Child
	err := row.Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate, &c.FatherHeight, &c.MotherHeight)
	return c, err
}

func (d *DB) ListChildren() ([]Child, error) {
	rows, err := d.pool.Query(`SELECT ` + childSelect + ` FROM children ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var children []Child
	for rows.Next() {
		c, err := scanChild(rows)
		if err != nil {
			return nil, err
		}
		children = append(children, c)
	}
	if children == nil {
		children = []Child{}
	}
	return children, nil
}

func (d *DB) GetChild(id string) (Child, error) {
	row := d.pool.QueryRow(`SELECT `+childSelect+` FROM children WHERE id=$1`, id)
	c, err := scanChild(row)
	if err == sql.ErrNoRows {
		return c, fmt.Errorf("child not found")
	}
	return c, err
}

func (d *DB) CreateChild(name, gender, birthDate string, fatherHeight, motherHeight *float64) (Child, error) {
	row := d.pool.QueryRow(
		`INSERT INTO children (name, gender, birth_date, father_height, mother_height)
		 VALUES ($1,$2,$3,$4,$5) RETURNING `+childSelect,
		name, gender, birthDate, fatherHeight, motherHeight,
	)
	return scanChild(row)
}

func (d *DB) UpdateChild(id, name, gender, birthDate string, fatherHeight, motherHeight *float64) (Child, error) {
	row := d.pool.QueryRow(
		`UPDATE children SET name=$1, gender=$2, birth_date=$3, father_height=$4, mother_height=$5
		 WHERE id=$6 RETURNING `+childSelect,
		name, gender, birthDate, fatherHeight, motherHeight, id,
	)
	c, err := scanChild(row)
	if err == sql.ErrNoRows {
		return c, fmt.Errorf("child not found")
	}
	return c, err
}

func (d *DB) DeleteChild(id string) error {
	res, err := d.pool.Exec(`DELETE FROM children WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("child not found")
	}
	return nil
}

// ─── Measurements ─────────────────────────────────────────────────────────────

func (d *DB) ListMeasurements(childID string) ([]Measurement, error) {
	rows, err := d.pool.Query(
		`SELECT id, child_id, TO_CHAR(measure_date,'YYYY-MM-DD'), height_cm, weight_kg FROM measurements WHERE child_id=$1 ORDER BY measure_date`,
		childID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ms []Measurement
	for rows.Next() {
		var m Measurement
		if err := rows.Scan(&m.ID, &m.ChildID, &m.MeasureDate, &m.HeightCm, &m.WeightKg); err != nil {
			return nil, err
		}
		ms = append(ms, m)
	}
	if ms == nil {
		ms = []Measurement{}
	}
	return ms, nil
}

func (d *DB) AddMeasurement(childID, date string, heightCm, weightKg *float64) (Measurement, error) {
	var m Measurement
	err := d.pool.QueryRow(
		`INSERT INTO measurements (child_id, measure_date, height_cm, weight_kg)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (child_id, measure_date) DO UPDATE SET height_cm=$3, weight_kg=$4
		 RETURNING id, child_id, TO_CHAR(measure_date,'YYYY-MM-DD'), height_cm, weight_kg`,
		childID, date, heightCm, weightKg,
	).Scan(&m.ID, &m.ChildID, &m.MeasureDate, &m.HeightCm, &m.WeightKg)
	return m, err
}

func (d *DB) DeleteMeasurement(childID, measureID string) error {
	res, err := d.pool.Exec(`DELETE FROM measurements WHERE id=$1 AND child_id=$2`, measureID, childID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("measurement not found")
	}
	return nil
}
