package store

import (
	"strings"
	"time"
)

const HuddleBusinessTimeZone = "America/Los_Angeles"

func normalizeHuddleDate(value string) (string, error) {
	value = strings.TrimSpace(value)
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil || parsed.Year() < 1 || parsed.Format("2006-01-02") != value {
		return "", ErrInvalid
	}
	return value, nil
}

func huddleDateForCreate(now time.Time) (string, error) {
	if now.IsZero() {
		now = time.Now()
	}
	location, err := time.LoadLocation(HuddleBusinessTimeZone)
	if err != nil {
		return "", err
	}
	return now.In(location).Format("2006-01-02"), nil
}
