# Tennishallen rund um Mannheim

Lokaler Wochenplan für freie Tennis-Hallenplätze. Viernheim, Schriesheim, Friedrichsfeld, Rheinau, Plankstadt, Pawlik in Ladenburg, Eppelheim, das Sportcenter Tröndle und Hockenheim sind vorausgewählt.

```bash
npm start
```

Öffne [den Wochenplan](http://127.0.0.1:3000/) mit Node.js 22 oder neuer. Die App startet in der nächsten Kalenderwoche. Wähle im Uhrzeitfilter z. B. **17:00–18:00 Uhr**, um diese Stunde an allen sieben Tagen zu vergleichen. Ein Klick auf eine Zelle zeigt die Plätze je Halle und führt zum Buchungsplan des Anbieters.

Unter **Meine Hallen** lassen sich weitere öffentlich einsehbare Hallenpläne von tennis04, eBuSy und Sportision per URL hinzufügen. Hallenlisten werden lokal im Browser gespeichert. Die App prüft in den öffentlichen Plänen, ob ein Tennisplatz für die gesamte Stunde frei ist. Die endgültige Buchbarkeit prüft der jeweilige Anbieter im eigenen Buchungsplan.

`npm test` prüft Datumsgrenzen, Anbieter-URLs und die Stundenauswertung.
