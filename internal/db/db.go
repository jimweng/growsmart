package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// DB wraps the connection pool.
type DB struct {
	pool *sql.DB
}

// User represents an OAuth-authenticated user.
type User struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
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
		`CREATE TABLE IF NOT EXISTS users (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			provider    TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			email       TEXT,
			name        TEXT,
			avatar_url  TEXT,
			created_at  TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (provider, provider_id)
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token      TEXT PRIMARY KEY,
			user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		)`,
		`ALTER TABLE children ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)`,
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

// ─── Users & Sessions ────────────────────────────────────────────────────────

func (d *DB) UpsertUser(provider, providerID, email, name, avatarURL string) (User, error) {
	var u User
	err := d.pool.QueryRow(
		`INSERT INTO users (provider, provider_id, email, name, avatar_url)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (provider, provider_id) DO UPDATE
		   SET email=$3, name=$4, avatar_url=$5
		 RETURNING id, provider, COALESCE(email,''), COALESCE(name,''), COALESCE(avatar_url,'')`,
		provider, providerID, email, name, avatarURL,
	).Scan(&u.ID, &u.Provider, &u.Email, &u.Name, &u.AvatarURL)
	return u, err
}

func (d *DB) CreateSession(userID string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err := d.pool.Exec(
		`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)`,
		token, userID, expires,
	)
	return token, err
}

func (d *DB) GetSessionUser(token string) (User, error) {
	var u User
	err := d.pool.QueryRow(
		`SELECT u.id, u.provider, COALESCE(u.email,''), COALESCE(u.name,''), COALESCE(u.avatar_url,'')
		 FROM sessions s JOIN users u ON s.user_id = u.id
		 WHERE s.token=$1 AND s.expires_at > NOW()`,
		token,
	).Scan(&u.ID, &u.Provider, &u.Email, &u.Name, &u.AvatarURL)
	if err == sql.ErrNoRows {
		return u, fmt.Errorf("session not found or expired")
	}
	return u, err
}

func (d *DB) DeleteSession(token string) error {
	_, err := d.pool.Exec(`DELETE FROM sessions WHERE token=$1`, token)
	return err
}

// ClaimUnownedChildren assigns all children without an owner to the given user.
// Called once for the first user who logs in, to preserve existing data.
func (d *DB) ClaimUnownedChildren(userID string) error {
	_, err := d.pool.Exec(`UPDATE children SET user_id=$1 WHERE user_id IS NULL`, userID)
	return err
}

// ─── Children ────────────────────────────────────────────────────────────────

const childSelect = `id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD'), father_height, mother_height`

func scanChild(row interface{ Scan(...any) error }) (Child, error) {
	var c Child
	err := row.Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate, &c.FatherHeight, &c.MotherHeight)
	return c, err
}

func (d *DB) ListChildren(userID string) ([]Child, error) {
	rows, err := d.pool.Query(
		`SELECT `+childSelect+` FROM children WHERE user_id=$1 ORDER BY created_at`,
		userID,
	)
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

func (d *DB) GetChild(id, userID string) (Child, error) {
	row := d.pool.QueryRow(
		`SELECT `+childSelect+` FROM children WHERE id=$1 AND user_id=$2`,
		id, userID,
	)
	c, err := scanChild(row)
	if err == sql.ErrNoRows {
		return c, fmt.Errorf("child not found")
	}
	return c, err
}

func (d *DB) CreateChild(name, gender, birthDate string, fatherHeight, motherHeight *float64, userID string) (Child, error) {
	row := d.pool.QueryRow(
		`INSERT INTO children (name, gender, birth_date, father_height, mother_height, user_id)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+childSelect,
		name, gender, birthDate, fatherHeight, motherHeight, userID,
	)
	return scanChild(row)
}

func (d *DB) UpdateChild(id, name, gender, birthDate string, fatherHeight, motherHeight *float64, userID string) (Child, error) {
	row := d.pool.QueryRow(
		`UPDATE children SET name=$1, gender=$2, birth_date=$3, father_height=$4, mother_height=$5
		 WHERE id=$6 AND user_id=$7 RETURNING `+childSelect,
		name, gender, birthDate, fatherHeight, motherHeight, id, userID,
	)
	c, err := scanChild(row)
	if err == sql.ErrNoRows {
		return c, fmt.Errorf("child not found")
	}
	return c, err
}

func (d *DB) DeleteChild(id, userID string) error {
	res, err := d.pool.Exec(`DELETE FROM children WHERE id=$1 AND user_id=$2`, id, userID)
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
