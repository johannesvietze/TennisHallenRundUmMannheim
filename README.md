# Tennishallen rund um Mannheim

Lokaler Wochenplan für freie Tennis-Hallenplätze. Viernheim, Schriesheim, Friedrichsfeld, Rheinau, Plankstadt, Pawlik in Ladenburg, Eppelheim, das Sportcenter Tröndle, Hockenheim, Walldorf, der TC Weinheim 1902 und das LLZ Leimen sind vorausgewählt.

```bash
npm start
```

Öffne [den Wochenplan](http://127.0.0.1:3000/) mit Node.js 22 oder neuer. Die App startet in der nächsten Kalenderwoche. Wähle im Uhrzeitfilter z. B. **17:00–18:00 Uhr**, um diese Stunde an allen sieben Tagen zu vergleichen. Ein Klick auf eine Zelle zeigt die Plätze je Halle und führt zum Buchungsplan des Anbieters.

Unter **Meine Hallen** lassen sich vorhandene Hallen aktivieren oder deaktivieren. Die Auswahl wird lokal im Browser gespeichert. Fehlende Hallen kannst du über ein GitHub Issue vorschlagen. Die App prüft in den öffentlichen Plänen, ob ein Tennisplatz für die gesamte Stunde frei ist. Bei Eversports sind Verfügbarkeit und Preise direkt im verlinkten Tennis-Buchungsplan einsehbar. Die endgültige Buchbarkeit prüft der jeweilige Anbieter im eigenen Buchungsplan.

`npm test` prüft Datumsgrenzen, Anbieter-URLs und die Stundenauswertung.

## Besuchszähler

Der Zähler neben **Meine Hallen** zeigt die Gesamtzahl der Aufrufe seit seiner Einbindung. Der Browser lädt das Bild von Hits.sh, wo auch der Zählerstand gespeichert wird. Erneutes Laden kann als weiterer Aufruf zählen. Für den Zähler sind auf Render keine Umgebungsvariablen und kein Speicher nötig. [Hits.sh-Dokumentation](https://github.com/silentsoft/hits#readme)
