DB_HOST  ?= localhost
DB_PORT  ?= 5434
DB_USER  ?= growsmart
DB_PASS  ?= growsmart
DB_NAME  ?= growsmart
PORT     ?= 8090

.PHONY: db run up down build

# Start only PostgreSQL in Docker (for local dev with host-side Go binary)
db:
	docker compose up -d db

# Run Go server directly on host — can access local claude CLI
run: db
	DB_HOST=$(DB_HOST) DB_PORT=$(DB_PORT) DB_USER=$(DB_USER) \
	DB_PASSWORD=$(DB_PASS) DB_NAME=$(DB_NAME) PORT=$(PORT) \
	go run ./cmd/server

# Build binary then run on host
build:
	go build -o ./growsmart-bin ./cmd/server

run-bin: db build
	DB_HOST=$(DB_HOST) DB_PORT=$(DB_PORT) DB_USER=$(DB_USER) \
	DB_PASSWORD=$(DB_PASS) DB_NAME=$(DB_NAME) PORT=$(PORT) \
	./growsmart-bin

# Full Docker Compose (production / no local claude needed)
up:
	docker compose up -d --build

down:
	docker compose stop
