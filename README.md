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
| Inloggning och behörighet | Roller admin, kontor och mekaniker, användarhantering | [`drift`](contracts/drift.openapi.yaml) |
| SMS till kund | Bokningsbekräftelse, påminnelse, "bilen är klar", servicepåminnelse, egna SMS | [`drift`](contracts/drift.openapi.yaml) |
| Bokföring | SIE 4-export till bokföringsprogram, kundreskontra | [`drift`](contracts/drift.openapi.yaml) |
| Fordonsuppslag | Hämta fordonsuppgifter på regnummer | [`drift`](contracts/drift.openapi.yaml) |
| Däckhotell och service | Däckförvaring på hyllplats, service- och besiktningspåminnelser | [`drift`](contracts/drift.openapi.yaml) |

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

Första gången du öppnar programmet skapar du verkstadens administratör. Med `npm run seed` skapas i stället demo-inloggningen
`admin@exempel.se` / `autoflow123` (samt `sara@exempel.se` / `mekaniker1` och `kontor@exempel.se` / `kontoret1`). Byt lösenord innan programmet används på riktigt.

Gå sedan till **Inställningar** och fyll i verkstadens uppgifter (visas på offerter och fakturor), SMS-mallar och kontoplan.

## Driftsättning med Docker
```bash
docker compose --profile app up -d --build   # databas + program på http://localhost:3000
```
Sätt `COOKIE_SECURE=true` när programmet körs bakom HTTPS, och ett eget `DB_PASSWORD`.

## Koppla in externa tjänster
Inställningarna görs med miljövariabler (se `server/.env.example`).

- **SMS:** som standard sparas meddelandena bara i historiken. För att skicka på riktigt, skaffa ett konto hos
  [46elks](https://46elks.se) och sätt `SMS_PROVIDER=46elks`, `SMS_46ELKS_USERNAME` och `SMS_46ELKS_PASSWORD`.
- **Fordonsuppslag:** uppslaget söker alltid först i ert eget register. Uppgifter om nya fordon kommer från Transportstyrelsens
  register via en dataleverantör (abonnemang krävs). Sätt `VEHICLE_LOOKUP_URL` (med `{reg}` där regnumret ska stå) och
  `VEHICLE_LOOKUP_TOKEN`. Svaret mappas automatiskt om det innehåller vanliga fältnamn (make/brand/märke, model/modell, year/årsmodell, vin, fuel/drivmedel);
  annars anpassas `server/src/modules/vehicle-lookup/routes.ts`.
- **Bokföring:** exportera SIE-filen under Bokföring och läs in den i ert bokföringsprogram. Kontona ställs in under Inställningar.

Databasadress ställs in med `DATABASE_URL` (se `server/.env.example`). Tester använder `TEST_DATABASE_URL`, standard `postgres://autoflow:autoflow@localhost:5432/autoflow_test`.

```bash
npm test                    # API-tester
npm run typecheck
npm run build               # bygger webben till web/dist
```
