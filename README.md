# AutoFlow Workshop

Modulärt verkstadssystem för bilverkstäder, med MVP per modul, egna API-kontrakt och releaseplan.

## Moduler
- **Kunder och fordon** (v0.1): kundregister, fordon på regnummer, sök. Kontrakt: [`contracts/kunder-fordon.openapi.yaml`](contracts/kunder-fordon.openapi.yaml)
- Arbetsordrar, tidbok, artiklar och lager, offert och faktura: se [releaseplanen](docs/releaseplan.md).

## Teknik
- `server/`: Node.js, TypeScript, Fastify, PostgreSQL, Zod-validering, Vitest
- `web/`: React + Vite

## Kom igång
Kräver Node 22+ och PostgreSQL 16 (eller Docker).

```bash
docker compose up -d        # startar PostgreSQL (databaserna autoflow och autoflow_test)
npm install
npm run dev:server          # API på http://localhost:3000 (kör migreringar vid start)
npm run dev:web             # webb på http://localhost:5173
```

Databasadress ställs in med `DATABASE_URL` (se `server/.env.example`). Tester använder `TEST_DATABASE_URL`, standard `postgres://autoflow:autoflow@localhost:5432/autoflow_test`.

```bash
npm test                    # API-tester
npm run typecheck
```
