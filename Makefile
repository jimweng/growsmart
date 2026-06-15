DB_HOST    ?= localhost
DB_PORT    ?= 5434
DB_USER    ?= growsmart
DB_PASS    ?= growsmart
DB_NAME    ?= growsmart
PORT       ?= 8090
PROXY_PORT ?= 9999

.PHONY: db proxy run up down build

# Start only PostgreSQL in Docker
db:
	docker compose up -d db

# Run host-side claude proxy (bridges Docker → local claude CLI)
proxy:
	PROXY_PORT=$(PROXY_PORT) go run ./cmd/claude-proxy

# Run Go server on host (for dev without Docker)
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

# Full stack: proxy on host + app+db in Docker
# Terminal 1: make proxy
# Terminal 2: make up
up:
	docker compose up -d --build

down:
	docker compose stop
