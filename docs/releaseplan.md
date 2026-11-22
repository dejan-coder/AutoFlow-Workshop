# Releaseplan

Varje modul levereras som en egen MVP med eget API-kontrakt i `contracts/` och egna tester.

| Version | Modul | MVP-innehåll | Status |
|---|---|---|---|
| 0.1 | Kunder och fordon | Kundregister (privat/företag), fordon på regnummer, sök, koppla fordon till kund | Klar |
| 0.2 | Arbetsordrar | Order på fordon, arbetsrader (tid) och artikelrader, status inkommen → pågår → klar | Planerad |
| 0.3 | Tidbok | Bokning per dag och mekaniker, bokning blir arbetsorder | Planerad |
| 0.4 | Artiklar och lager | Artikelregister, inköps-/utpris, lagersaldo som dras vid order | Planerad |
| 0.5 | Offert och faktura | Offert → order, faktura från order, moms, löpande fakturanummer, PDF | Planerad |
| 0.6+ | Övrigt | Rapporter, användare och behörighet, SMS-påminnelser, bokföringsexport | Idé |

## Principer
- Ett modulnamn = en mapp i `server/src/modules/` och ett kontrakt i `contracts/`.
- Databasändringar görs bara med nya, numrerade filer i `server/migrations/`.
- Ändringar som bryter ett kontrakt kräver ny huvudversion av kontraktet.
