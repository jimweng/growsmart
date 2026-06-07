package main

import (
	"log"
	"net/http"
	"os"

	"github.com/jimweng/growsmart/internal/db"
	"github.com/jimweng/growsmart/internal/handler"
)

func main() {
	database, err := db.Connect()
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	if err := database.Migrate(); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	h := handler.New(database)
	mux := http.NewServeMux()
	h.Register(mux)
	mux.Handle("/", http.FileServer(http.Dir("web")))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	addr := ":" + port
	log.Printf("GrowSmart running at http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
