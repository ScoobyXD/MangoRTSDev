package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
)

var errRetiredByV3Cutover = errors.New("node history compaction is retired: V3 stores current Node bodies in node_textboxes and no longer keeps the projection/history tables this command rewrote")

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(_ context.Context, _ []string, _ io.Writer) error {
	return fmt.Errorf("%w; use the strict V3 database migration and the V3-aware attachment migrator instead", errRetiredByV3Cutover)
}
