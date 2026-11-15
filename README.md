# Tennishallen rund um Mannheim

Lokaler Wochenplan für freie Tennis-Hallenplätze. Viernheim, Schriesheim, Friedrichsfeld, Rheinau, Plankstadt, Pawlik in Ladenburg, Eppelheim, das Sportcenter Tröndle, Hockenheim und Walldorf sind vorausgewählt.

```bash
npm start
```

Öffne [den Wochenplan](http://127.0.0.1:3000/) mit Node.js 22 oder neuer. Die App startet in der nächsten Kalenderwoche. Wähle im Uhrzeitfilter z. B. **17:00–18:00 Uhr**, um diese Stunde an allen sieben Tagen zu vergleichen. Ein Klick auf eine Zelle zeigt die Plätze je Halle und führt zum Buchungsplan des Anbieters.

Unter **Meine Hallen** lassen sich vorhandene Hallen aktivieren oder deaktivieren. Die Auswahl wird lokal im Browser gespeichert. Fehlende Hallen kannst du über ein GitHub Issue vorschlagen. Die App prüft in den öffentlichen Plänen, ob ein Tennisplatz für die gesamte Stunde frei ist. Bei Eversports sind Verfügbarkeit und Preise direkt im verlinkten Tennis-Buchungsplan einsehbar. Die endgültige Buchbarkeit prüft der jeweilige Anbieter im eigenen Buchungsplan.

`npm test` prüft Datumsgrenzen, Anbieter-URLs und die Stundenauswertung.

## Besuchszähler

Der Zähler neben **Meine Hallen** zeigt die von Cloudflare erfassten Besuche der letzten sieben Tage. Der Server speichert die Zahl für fünf Minuten zwischen. Setze diese Umgebungsvariablen auf dem Server, bei Render in den Einstellungen unter **Environment**.

- `CLOUDFLARE_ACCOUNT_ID` ist die [Cloudflare-Konto-ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).
- `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` ist die Kennung der Website. Öffne den Bericht für diese Website in Cloudflare Web Analytics und kopiere den Wert hinter `siteTag~in=` aus der Adresszeile. Die Kennung steht auch als `site_tag` in der [Cloudflare-Site-Liste](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/list/).
- `CLOUDFLARE_API_TOKEN` ist ein separater, geheimer [API-Token](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/) mit **Account → Account Analytics → Read** für dieses Konto.

Der Zähler erscheint, sobald der Server eine Besuchszahl erhält.
