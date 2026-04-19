# Frontend quick start (Node Module MVP)

If you're running this project locally, you should run **both backend and frontend**.

## 1) Start backend first

Open terminal #1:

```bash
cd backend
go run ./cmd/miraeopus-api
```

This starts the API on `http://localhost:8080`.

## 2) Start frontend second

Open terminal #2:

```bash
cd frontend
npm install
npm run dev
```

Vite will print a local URL (usually `http://localhost:5173`).
Open that URL in your browser.

## 3) Confirm wiring

- Frontend calls backend at `http://localhost:8080` by default.
- If needed, override with env vars before `npm run dev`:

```bash
export VITE_API_BASE=http://localhost:8080
export VITE_COMPANY_ID=11111111-1111-1111-1111-111111111111
```

## One-command mental model

- **Backend terminal:** `cd backend && go run ./cmd/miraeopus-api`
- **Frontend terminal:** `cd frontend && npm run dev`
