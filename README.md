# AutoFlow Workshop

Modulärt verkstadssystem för bilverkstäder, med MVP per modul, egna API-kontrakt och releaseplan.

## Moduler
| Modul | Vad den gör | Kontrakt |
|---|---|---|
| Kunder och fordon | Kundregister (privat/företag), fordon på svenska regnummer, sök, historik | [`kunder-fordon`](contracts/kunder-fordon.openapi.yaml) |
| Arbetsordrar | Order på fordon med arbete och artiklar, status inkommen → pågår → klar → fakturerad | [`arbetsordrar`](contracts/arbetsordrar.openapi.yaml) |
| Tidbok | Veckovy per mekaniker, kontroll av dubbelbokning, bokning blir arbetsorder | [`tidbok`](contracts/tidbok.openapi.yaml) |
| Artiklar och lager | Artiklar, priser, lagersaldo som dras automatiskt, inleverans, inventering | [`artiklar-lager`](contracts/artiklar-lager.openapi.yaml) |
| Offert och faktura | Offert → arbetsorder, faktura med moms och öresavrundning, PDF, betalning, kreditering | [`offert-faktura`](contracts/offert-faktura.openapi.yaml) |
| Översikt och rapporter | Nyckeltal, försäljning per period, timmar per mekaniker, inställningar | [`offert-faktura`](contracts/offert-faktura.openapi.yaml) |

Se [releaseplanen](docs/releaseplan.md) för versioner och nästa steg.

## Teknik
- `server/`: Node.js, TypeScript, Fastify, PostgreSQL, Zod-validering, PDFKit, Vitest
- `web/`: React + Vite
- `contracts/`: OpenAPI 3.1 per modul, delade schema i `common.yaml`

## Kom igång
Kräver Node 22+ och PostgreSQL 16 (eller Docker).

```bash
docker compose up -d        # startar PostgreSQL (databaserna autoflow och autoflow_test)
npm install
npm run seed                # valfritt: exempelkunder, fordon, artiklar, ordrar och bokningar
npm run dev:server          # API på http://localhost:3000 (kör migreringar vid start)
npm run dev:web             # webb på http://localhost:5173
```

Gå sedan till **Inställningar** och fyll i verkstadens uppgifter (visas på offerter och fakturor).

Databasadress ställs in med `DATABASE_URL` (se `server/.env.example`). Tester använder `TEST_DATABASE_URL`, standard `postgres://autoflow:autoflow@localhost:5432/autoflow_test`.

```bash
npm test                    # API-tester
npm run typecheck
npm run build               # bygger webben till web/dist
```
