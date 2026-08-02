package main

import (
	"context"
	"errors"
	"io"
	"testing"
)

func TestCommandIsExplicitlyRetiredAfterV3Cutover(t *testing.T) {
	err := run(context.Background(), nil, io.Discard)
	if !errors.Is(err, errRetiredByV3Cutover) {
		t.Fatalf("run error = %v, want errRetiredByV3Cutover", err)
	}
}
