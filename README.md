# 8BG · Handelsverwaltung

Eine deutschsprachige Mehrbenutzer-Webanwendung für RP-Personenakten, Produkte, Ankäufe und Verkäufe. Dunkles Design mit lila Akzenten, Seitenleiste und responsiven Personenkarten.

## Funktionen

- **Personen:** Kartenansicht, Suche nach Name/Telefon/Notiz, Detailansicht, Bearbeiten und Archivieren. Gespeichert werden Name, Geburtsdatum, Telefonnummer und Notizen.
- **RP-Ausweise:** PNG, JPG oder WebP hochladen; tatsächliches Bildformat wird geprüft. Speicherung ausschließlich als neu erzeugtes WebP ohne Original-Metadaten. Lokale deutsche Texterkennung mit Tesseract; Name und Geburtsdatum werden zur manuellen Prüfung übernommen. Es werden keine Ausweisbilder an Cloud- oder KI-Dienste übermittelt.
- **Produkte:** Namen sowie getrennte Ankauf- und Verkaufspreise anlegen und bearbeiten; Produkte deaktivieren, ohne sie aus der Historie zu entfernen. Die Datenbank startet bewusst ohne erfundene Geschäftsdaten.
- **An- & Verkauf:** Buchungsrichtung ausdrücklich wählen. Beim Ankauf kauft der Betrieb Produkte von der gewählten Person und erfasst die Auszahlung zum Ankaufpreis. Beim Verkauf verkauft er Produkte an die Person und erfasst die Einnahme zum Verkaufspreis. In beiden Richtungen Person, Mengen, Gesamtsumme und optionale Notiz dokumentieren. Währung: RP-Dollar (`$`), Preise mit zwei Nachkommastellen.
- **Verlauf:** Paginiert, mit Filter für Ankäufe, Verkäufe oder beide. Jede Buchung zeigt Richtung, Einzelpositionen, Person, erfassenden Benutzer und Zeitpunkt. Dashboard und Verlauf weisen Auszahlungen und Einnahmen getrennt aus. Personen-/Produktnamen und Preise werden als historischer Stand gespeichert. Buchungen können nicht nachträglich verändert oder gelöscht werden.
- **Team:** Login, Administrator-/Mitarbeiterrollen, zusätzliche Zugänge, Passwortwechsel und administrativer Passwort-Reset.

## Lokal starten

Voraussetzungen: **Node.js 24 oder neuer** und npm. Es ist kein externer Datenbankserver nötig.

```powershell
Set-Location C:\Users\stein\Desktop\8BG
npm ci
npm run build
npm start
```

Dann **http://127.0.0.1:3001** öffnen.

Beim ersten Start wird im Terminal ein zufälliger **Einrichtungsschlüssel** angezeigt. Diesen im Einrichtungsformular eingeben und einen eigenen Administrator-Benutzernamen mit Passwort festlegen. Es gibt keine Standard-Zugangsdaten. Der Schlüssel wird bei jedem Serverstart neu erzeugt und funktioniert nur, solange noch kein Benutzer existiert.

Passwörter müssen 12–128 Zeichen enthalten. Benutzernamen bestehen aus 3–40 Buchstaben/Zahlen sowie Punkt, Bindestrich oder Unterstrich.

### Entwicklung

```powershell
npm run dev
```

Frontend: **http://127.0.0.1:5173**, Backend: **http://127.0.0.1:3001**. Vite leitet API-Anfragen an das Backend weiter. Beide Prozesse werden gemeinsam beendet. Den Einrichtungsschlüssel zeigt das Backend-Terminal.

## Bedienung

1. Unter **Einstellungen** Teamzugänge anlegen. Administratoren können zusätzlich Produkte und Benutzer verwalten. Mitarbeiter können Personen, An- und Verkäufe erfassen und den gemeinsamen Verlauf einsehen.
2. Unter **Produkte** Produktnamen sowie getrennte Ankaufs- und Verkaufspreise pro Einheit eintragen.
3. Unter **Personen** eine Akte erstellen. Optional einen **fiktiven RP-Ausweis** hochladen. Nach der Erkennung die vorgeschlagenen Daten kontrollieren, fehlende Angaben ergänzen und die Prüfung bestätigen.
4. Unter **Handel** zuerst **Ankauf** (Betrieb kauft von der Person) oder **Verkauf** (Betrieb verkauft an die Person) wählen und dann Mengen eintragen. Das zusätzliche Mengenfeld mit `+` addiert die angegebene Menge; ohne Angabe wird `1` addiert. Preis und Auszahlung/Einnahme wechseln passend zur Richtung.
5. Die beteiligte Person auswählen und den passenden An- oder Verkauf speichern. Der Server prüft Richtung, Produkte und zugehörige Preise und berechnet alle Beträge selbst in ganzzahligen Cent.
6. Unter **Verlauf** Ankäufe oder Verkäufe filtern und Richtung sowie Einzelpositionen aufrufen.

Ändert jemand zwischenzeitlich einen Produktpreis, wird der Ankauf mit einem Hinweis abgelehnt. Seite neu laden und Betrag erneut prüfen. Wiederholtes Absenden derselben Buchung erzeugt keine Doppelbuchung.

### Ausweiserkennung und Grenzen

Die OCR arbeitet lokal auf dem Server; auch die deutsche Sprachdatei ist als npm-Abhängigkeit mitgeliefert. Nach der Installation sind keine Sprachmodell-Downloads notwendig. Schrift, Kontrast, Auflösung und Bildausschnitt beeinflussen die Erkennung. Dekorative RP-Ausweise können eine manuelle Korrektur erfordern. Die Anwendung führt **keine Identitäts-/Echtheitsprüfung** durch und liest keine QR-Codes aus. Telefonnummer und Notizen werden manuell ergänzt.

Bei einem OCR-Fehler bleibt das gültige WebP verfügbar und eine ausdrückliche Warnung fordert zur manuellen Eingabe auf. Name und Geburtsdatum müssen vor dem Speichern geprüft werden.

Uploads: maximal **12 MB**, **20 Megapixel**, ein nicht animiertes PNG/JPEG/WebP; Speicherung auf maximal 2000 × 2000 Pixel begrenzt. Es wird jeweils nur ein Scan verarbeitet, um die lokale OCR nicht zu überlasten. Dateien sind ausschließlich über eine authentifizierte API abrufbar. Noch nicht zugeordnete Bilder sieht nur der hochladende Benutzer.

Beim Abbrechen einer Akte wird ihr neuer Upload entfernt. Nach einem geschlossenen Tab/Verbindungsabbruch übrig gebliebene, nicht zugeordnete Bilder werden beim Start und stündlich nach 24 Stunden bereinigt.

## Speicherung, Betrieb und Sicherungen

- React + TypeScript + Vite; Node.js + Express; SQLite über das integrierte `node:sqlite`; Sharp für WebP; Tesseract für OCR.
- SQLite und Ausweisbilder liegen standardmäßig in **`.data`** im Projektordner. Dieser Ordner ist von Git ausgeschlossen, ebenso Abhängigkeiten, Builds und Testausgaben.
- Daten sind zentral für alle angemeldeten Teammitglieder verfügbar. Browserneuladen oder Serverneustart löscht sie nicht. Sitzungen werden in SQLite gespeichert und laufen nach 12 Stunden ab.
- Für einen vollständigen **Backup** den Server stoppen, den gesamten Datenordner sichern und danach neu starten. Zur Wiederherstellung den Server stoppen und den gesicherten Datenordner zurückspielen. Vor Updates immer sichern. Datenbank und Bilddateien gehören zusammen.
- Ein **einzelner Serverprozess** mit einem persistenten lokalen Datenverzeichnis ist vorgesehen; kein Serverless-/Mehrinstanzbetrieb. SQLite ist in Node 24 noch als experimentelle API gekennzeichnet. Die entsprechende Startwarnung ist normal.
- Der Node-Prozess braucht Schreibzugriff auf den Datenordner. Dieser darf nicht als öffentliches statisches Verzeichnis ausgeliefert werden.
- Ein öffentliches GitHub-Repository veröffentlicht nur den Quellcode, **nicht** die laufende Website oder ihre Daten. GitHub Pages allein reicht wegen Backend, Login und SQLite nicht aus.

### Einstellungen über Prozessvariablen

Die Anwendung liest Prozessvariablen direkt; eine zusätzliche Konfigurationsdatei ist nicht erforderlich:

| Variable | Standard | Zweck |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind-Adresse; nur für einen gewollten Netzwerkbetrieb ändern |
| `PORT` | `3001` | Backend-/Produktionsport |
| `DATA_DIR` | `.data` | Persistenter Datenordner, vorzugsweise absolut |
| `APP_ORIGIN` | Origin der Anfrage | Exakte externe Origin ohne abschließenden Slash, z. B. `https://handel.example.com` |
| `COOKIE_SECURE` | `0` | Für HTTPS zwingend `1`; nur lokal bei HTTP `0` |

Beispiel für einen HTTPS-Reverse-Proxy auf demselben Host:

```powershell
$env:APP_ORIGIN = "https://handel.example.com"
$env:COOKIE_SECURE = "1"
$env:DATA_DIR = "C:\8BG-Daten"
npm start
```

Der Reverse-Proxy muss HTTPS erzwingen und Anfragen an den lokalen Backend-Port weiterleiten. Für Betrieb auf einem anderen Host können `HOST` und Firewall bewusst angepasst werden. Die Anwendung selbst stellt kein TLS-Zertifikat bereit. Ein externer Proxy sollte zusätzlich Login-/Upload-Raten begrenzen; die integrierte Anmeldebegrenzung arbeitet pro direkter Client-IP, hinter einem Proxy also gegebenenfalls pro Proxy.

Nicht ohne HTTPS öffentlich bereitstellen. Keine echten Ausweisdaten für Tests verwenden. Aufbewahrung und Zugriff auf personenbezogene Daten müssen organisatorisch geregelt werden. Archivieren ist **keine Löschung**; bestehende Ankaufhistorien behalten ihre damaligen Namen. Personen mit Ankäufen können deshalb nur archiviert werden. Ein Ausweisbild lässt sich separat durch Bearbeiten der Akte entfernen. Ein administrativer Passwort-Reset meldet alle Sitzungen dieses Benutzers ab.

Passwörter werden mit scrypt und zufälligem Salt gehasht; Sitzungstokens sind zufällig und serverseitig nur gehasht gespeichert. Cookies sind HttpOnly/SameSite=Strict. Schreibende authentifizierte Anfragen benötigen zusätzlich einen CSRF-Token. Datenbankabfragen sind parametrisiert; Bilddateinamen werden serverseitig generiert.

## Prüfen

```powershell
npm run check
npm audit
```

`check` prüft die Frontend-/Backend-Typen, baut die Anwendung und führt die API-/OCR-Tests mit temporären Datenbanken aus. Getestet werden unter anderem Zugriffsrechte, Cent-Berechnung, Preisänderungen, historische Preisstände, Wiederholschutz, Uploadvalidierung, echte WebP-Dateien, OCR, Bereinigung und Persistenz.

Ein zusätzlicher echter Browser-Test deckt Einrichtung, Produktanlage, Ausweis-Upload mit OCR, Personenkarten, Mengenaddition, Ankauf, Verlauf und die mobile Ansicht ab:

```powershell
npm run build
npm run test:e2e
```

Dafür wird Microsoft Edge erwartet. Auf einem System ohne Edge zuerst `npx playwright install msedge` ausführen. Der Test startet einen separaten lokalen Server auf Port 4318 mit temporären Testdaten; der reguläre Datenordner bleibt unberührt.
