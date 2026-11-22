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

## Nästa steg (förslag)
| Version | Innehåll |
|---|---|
| 0.3 | Inloggning, användare och behörighet (verkstadschef, mekaniker, ekonomi) |
| 0.3 | Fordonsuppslag på regnummer mot extern fordonsdatatjänst |
| 0.4 | SMS/e-post till kund: bokningsbekräftelse, påminnelse, "bilen är klar" |
| 0.4 | Bokföringsexport (SIE) och betalfil/OCR |
| 0.5 | Inköpsordrar till leverantör, däckhotell, servicepåminnelser |
| 0.5 | Driftsättning: Docker-image för server och webb, backup |

## Principer
- Ett modulnamn = en mapp i `server/src/modules/` och ett kontrakt i `contracts/`.
- Databasändringar görs bara med nya, numrerade filer i `server/migrations/`.
- Ändringar som bryter ett kontrakt kräver ny huvudversion av kontraktet.
- Belopp lagras exkl. moms med två decimaler; moms räknas per momssats och totalen öresavrundas.
