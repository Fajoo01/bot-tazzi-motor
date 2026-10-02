# Bot-tazzi Flow

Editor mobile-first per progettare algoritmi e flussi software con blocchi e frecce.

## Funzioni

- Inizio/Fine, Azione, Decisione e Input/Output.
- Decisione con uscite distinte **NO** e **SÌ**.
- Trascinamento, pan, zoom e collegamento touch.
- Rinomina del blocco selezionato.
- Autosalvataggio locale nel browser.
- Import/export JSON portabile.
- Export e copia Mermaid per trasformare il disegno in specifica testuale.
- Manifest + service worker per uso PWA/offline dopo il primo caricamento.

## Sviluppo

```bash
cd tools/flow-designer
npm install
npm test
npm run build
npm run dev
```
## Uso da telefono

1. Aprire l'app nel browser.
2. Aggiungere un blocco dalla barra superiore.
3. Toccare un blocco e modificarne il testo.
4. Per creare una freccia, toccare un pallino d'uscita e poi un pallino d'ingresso.
5. Nei rombi usare l'uscita sinistra **NO** o destra **SÌ**.
6. Dal menu del browser scegliere "Aggiungi alla schermata Home" quando disponibile.

Il file JSON è il formato persistente di progetto; Mermaid è il formato di interscambio leggibile da Bot-tazzi e GitHub.
