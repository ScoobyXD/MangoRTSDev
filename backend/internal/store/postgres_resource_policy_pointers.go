package store

// Step 2 resolves policy state directly from the four canonical V2 tables.
// The legacy revision and subtree-application SQL remains frozen only in the
// database objects retained for Step 3 rollback evidence.
