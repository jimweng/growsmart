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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Gender    string `json:"gender"`
	BirthDate string `json:"birthDate"` // YYYY-MM-DD
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
func (d *DB) Migrate() error {
	_, err := d.pool.Exec(`
		CREATE EXTENSION IF NOT EXISTS pgcrypto;

		CREATE TABLE IF NOT EXISTS children (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name       TEXT NOT NULL,
			gender     TEXT NOT NULL CHECK (gender IN ('male','female')),
			birth_date DATE NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS measurements (
			id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			child_id     UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
			measure_date DATE NOT NULL,
			height_cm    NUMERIC(5,1),
			weight_kg    NUMERIC(5,2),
			created_at   TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (child_id, measure_date)
		);
	`)
	return err
}

// ─── Children ────────────────────────────────────────────────────────────────

func (d *DB) ListChildren() ([]Child, error) {
	rows, err := d.pool.Query(`SELECT id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD') FROM children ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var children []Child
	for rows.Next() {
		var c Child
		if err := rows.Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate); err != nil {
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
	var c Child
	err := d.pool.QueryRow(
		`SELECT id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD') FROM children WHERE id=$1`, id,
	).Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate)
	if err == sql.ErrNoRows {
		return c, fmt.Errorf("child not found")
	}
	return c, err
}

func (d *DB) CreateChild(name, gender, birthDate string) (Child, error) {
	var c Child
	err := d.pool.QueryRow(
		`INSERT INTO children (name, gender, birth_date) VALUES ($1,$2,$3) RETURNING id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD')`,
		name, gender, birthDate,
	).Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate)
	return c, err
}

func (d *DB) UpdateChild(id, name, gender, birthDate string) (Child, error) {
	var c Child
	err := d.pool.QueryRow(
		`UPDATE children SET name=$1, gender=$2, birth_date=$3 WHERE id=$4 RETURNING id, name, gender, TO_CHAR(birth_date,'YYYY-MM-DD')`,
		name, gender, birthDate, id,
	).Scan(&c.ID, &c.Name, &c.Gender, &c.BirthDate)
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
