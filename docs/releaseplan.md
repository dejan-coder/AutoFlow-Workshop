# Releaseplan

Varje modul levereras som en egen MVP med eget API-kontrakt i `contracts/` och egna tester.

| Version | Modul | MVP-innehåll | Kontrakt | Status |
|---|---|---|---|---|
| 0.1 | Kunder och fordon | Kundregister (privat/företag), fordon på regnummer, sök, koppla fordon till kund | `kunder-fordon.openapi.yaml` | Klar |
| 0.2 | Arbetsordrar | Order på fordon, arbets-/artikel-/övriga rader, statusflöde, låsning efter fakturering, fordonshistorik | `arbetsordrar.openapi.yaml` | Klar |
| 0.2 | Tidbok | Veckovy, bokning per mekaniker med kontroll av dubbelbokning, bokning blir arbetsorder | `tidbok.openapi.yaml` | Klar |
| 0.2 | Artiklar och lager | Artikelregister, in-/utpris, lagersaldo som dras på order, inleverans, inventering, rörelselogg, beställningspunkt | `artiklar-lager.openapi.yaml` | Klar |
| 0.2 | Offert och faktura | Offert med PDF som blir arbetsorder, faktura från order med moms per sats, öresavrundning, löpnummer, PDF, betalning, kreditering | `offert-faktura.openapi.yaml` | Klar |
| 0.2 | Översikt och rapporter | Nyckeltal, försäljning per period, debiterade timmar per mekaniker, verkstadsinställningar | `offert-faktura.openapi.yaml` | Klar |
| 0.3 | Inloggning och behörighet | Inloggning, roller (admin, kontor, mekaniker), användarhantering, byte av lösenord | `drift.openapi.yaml` | Klar |
| 0.3 | SMS till kund | Bokningsbekräftelse, påminnelse dagen innan, "bilen är klar", servicepåminnelse, egna SMS, mallar, historik | `drift.openapi.yaml` | Klar (46elks som tillval) |
| 0.3 | Bokföring | SIE 4-export av fakturor och inbetalningar, inställbar kontoplan, kundreskontra med åldersanalys | `drift.openapi.yaml` | Klar |
| 0.3 | Fordonsuppslag | Uppslag på regnummer i eget register och via extern dataleverantör | `drift.openapi.yaml` | Klar (leverantör kopplas in) |
| 0.3 | Däckhotell och service | Hyllplatser, säsong, mönsterdjup; service- och besiktningsdatum med påminnelser | `drift.openapi.yaml` | Klar |
| 0.3 | Driftsättning | Dockerfile och docker compose, en server för API och webb | – | Klar |

## Nästa steg (förslag)
| Version | Innehåll |
|---|---|
| 0.4 | E-post till kund med faktura/offert som PDF |
| 0.4 | Betalfil/OCR-nummer och avstämning mot bank |
| 0.5 | Inköpsordrar till leverantör och leverantörskatalog |
| 0.5 | Automatiska påminnelser (schemalagda), backup och loggning i drift |

## Principer
- Ett modulnamn = en mapp i `server/src/modules/` och ett kontrakt i `contracts/`.
- Databasändringar görs bara med nya, numrerade filer i `server/migrations/`.
- Ändringar som bryter ett kontrakt kräver ny huvudversion av kontraktet.
- Belopp lagras exkl. moms med två decimaler; moms räknas per momssats och totalen öresavrundas.
