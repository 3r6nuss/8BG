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

## Auf dem Server: Portainer, Nginx Proxy Manager und Cloudflare

Die mitgelieferte Konfiguration verwendet **https://8bg.3r6nuss.de** und das
bereits vorhandene Docker-Netzwerk **nginx-proxy-manager_default**. Sie ist fuer
einen einzelnen Docker-Server (kein Swarm) gedacht. Port 3001 wird nicht am Host
veroeffentlicht; Nginx Proxy Manager erreicht den Container intern.

### 1. Docker-Image auf dem Server bauen

Die folgenden Befehle im **SSH-Terminal deines Linux-Servers** ausfuehren,
nicht im Windows-Terminal und nicht in einem bestehenden Container:

```sh
git clone https://github.com/3r6nuss/8BG.git
cd 8BG
docker build -t 8bg:local .
```

Ist das Repository schon vorhanden, stattdessen in diesen Ordner wechseln und
`git pull --ff-only` ausfuehren. Der Build muss auf demselben Docker-Server
stattfinden, den Portainer verwaltet. Es gibt kein vorab veroeffentlichtes
Container-Image; `8bg:local` wird durch diesen Build erzeugt.

### 2. Portainer-Stack anlegen

1. **Stacks -> Add stack**, Name `8bg`, **Web editor**.
2. Den Inhalt von [docker-compose.portainer.yml](./docker-compose.portainer.yml)
   unveraendert einfuegen. Das Image wurde bereits im ersten Schritt gebaut.
3. Unter **Environment variables** `HEALTH_TOKEN` mit einem eigenen
   zufaelligen Wert von mindestens 32 Zeichen setzen. Zum Generieren kann
   auf dem Server `openssl rand -hex 32` verwendet werden. Den Wert vertraulich
   behandeln und nicht in Git speichern.
4. Stack bereitstellen. Keine Option zum erneuten Herunterladen des Images
   aktivieren; `8bg:local` ist ein lokales Image.
5. Unter **Containers -> 8bg-web-... -> Logs** den einmaligen
   Einrichtungsschluessel ablesen. Der konkrete Containername haengt von der
   Compose-Version ab; der Netzwerkname fuer den Proxy ist immer `8bg-web`.

Das benannte Volume `8bg_data` behaelt Datenbank und Bilder bei Updates.
Volume nicht loeschen. Fuer ein konsistentes Backup den Stack stoppen, das
gesamte Volume sichern und danach wieder starten. Lokal bereits vorhandene
Personen/Bilder werden nicht automatisch auf den Server uebertragen.

### 3. Cloudflare-DNS und HTTPS

1. Unter **DNS** einen **A-Record** `8bg` auf die oeffentliche IPv4-Adresse des
   Servers setzen. Einen AAAA-Record nur setzen, wenn IPv6 ebenfalls korrekt
   zum Proxy fuehrt.
2. Fuer die erste Einrichtung den Record auf **DNS only** (graue Wolke)
   stellen. Die Ports **80 und 443** muessen zum Nginx Proxy Manager fuehren.
   Portainer, die NPM-Verwaltungsoberflaeche und Port 3001 nicht oeffentlich
   freigeben.
3. Im **Nginx Proxy Manager -> Hosts -> Proxy Hosts -> Add Proxy Host**:
   - Domain Names: `8bg.3r6nuss.de`
   - Scheme: `http`
   - Forward Hostname / IP: `8bg-web`
   - Forward Port: `3001`
4. Unter **Advanced** eintragen, damit Ausweis-Uploads nicht am kleinen
   Standardlimit des Proxys scheitern und die OCR ausreichend Zeit bekommt:

   ```nginx
   client_max_body_size 16m;
   proxy_read_timeout 180s;
   ```

5. Unter **SSL** ein neues Let's-Encrypt-Zertifikat anfordern, die Bedingungen
   akzeptieren und **Force SSL** aktivieren. Erst nach erfolgreicher
   Zertifikatsausstellung weitergehen.
6. In Cloudflare **SSL/TLS -> Full (strict)** verwenden, niemals **Flexible**.
   Danach kann die orange Wolke (Proxied) aktiviert werden. Fuer diese
   Subdomain keine **Cache Everything**-Regel verwenden; insbesondere
   `/api/*` darf nicht zwischengespeichert werden.
7. **https://8bg.3r6nuss.de** oeffnen, den Einrichtungsschluessel aus den
   Container-Logs eingeben und den eigenen Admin-Zugang anlegen.

Bei **502 Bad Gateway** zuerst pruefen, ob NPM und 8BG im Netzwerk
`nginx-proxy-manager_default` sind und der 8BG-Container laeuft. Nach kurzer
Startzeit sollte Portainer den Container als **healthy** anzeigen.

### 4. Health-Checks der Serververwaltung aktivieren

Im bereits vorhandenen Serververwaltungs-Stack setzen:

```text
BG_HEALTH_URL=https://8bg.3r6nuss.de/api/health
BG_HEALTH_TOKEN=<derselbe Wert wie HEALTH_TOKEN im 8BG-Stack>
```

Die Serververwaltung muss ebenfalls die neue Health-Integration enthalten
und danach neu bereitgestellt werden. Eine Cloudflare-Access-Anmeldeseite
oder Browser-Challenge vor `/api/health` verhindert die automatische Abfrage;
fuer diesen Pfad eine passende Ausnahme konfigurieren, den Bearer-Token-Schutz
der Anwendung dabei beibehalten.

### Updates

Auf dem Server im geklonten Repository `git pull --ff-only` und danach
`docker build -t 8bg:local .` ausfuehren. In Portainer den 8BG-Container mit dem
neu gebauten lokalen Image **Recreate** ausfuehren, ohne das Image aus einer
Registry neu zu ziehen. Das Datenvolume beibehalten und vorher sichern.

### Mit der Serververwaltung verbinden

Der Health-Endpunkt **`/api/health`** stellt zwölf Einzelprüfungen bereit: Anwendung/Laufzeit, Datenbankverbindung, Schema und Integrität, Daten- und Ausweisspeicher, freien Speicherplatz, deutsche OCR-Sprachdaten, WebP-Encoder, Prozessspeicher und abgelaufene Sitzungen. Die Serververwaltung ergänzt diese um Antwortzeit, Uptime, P95-Latenz und Ausfallhistorie.

Einen gemeinsamen zufälligen Schlüssel generieren:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Den gleichen Wert in 8BG als `HEALTH_TOKEN` und in der Serververwaltung als `BG_HEALTH_TOKEN` konfigurieren. In der Serververwaltung außerdem die erreichbare URL als `BG_HEALTH_URL=https://8bg.example.com/api/health` einstellen. Anschließend beide Anwendungen neu starten beziehungsweise den Serververwaltungs-Stack neu bereitstellen. Ohne gültigen Token liefert der Health-Endpunkt keine Diagnosedaten. Ohne konfiguriertes `HEALTH_TOKEN` ist der Endpunkt nur für eine ausschließlich interne, nicht öffentlich erreichbare Installation gedacht.

**Netzwerk:** Die Serververwaltung muss 8BG direkt über HTTPS erreichen können. `localhost` zeigt innerhalb eines Containers auf den jeweiligen Container und eignet sich nicht als Adresse zwischen zwei Containern. Die Beispiel-URL muss durch die tatsächliche HTTPS-Adresse ersetzt werden, über die die Serververwaltung 8BG erreicht. Die Health-Antwort enthält ausschließlich Check-Namen, Status und begrenzte Kennzahlen, keine Zugangsdaten, Personendaten, Bildinhalte oder lokalen Dateipfade. Ohne `BG_HEALTH_URL` bleibt 8BG im Dashboard als „Nicht konfiguriert“ sichtbar.

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
5. Die Stückpreise sind mit den Produktpreisen der gewählten Richtung vorbelegt. Als angemeldetes Teammitglied kannst du sie für die aktuelle Buchung ändern (0 bis 1.000.000 $ je Einheit, maximal zwei Nachkommastellen). Produktstammpreise bleiben unverändert. Die beteiligte Person auswählen und den passenden An- oder Verkauf speichern. Der Server validiert Richtung, aktive Produkte und eingegebene Preise und berechnet alle Beträge selbst in ganzzahligen Cent.
6. Unter **Verlauf** Ankäufe oder Verkäufe filtern und Richtung sowie Einzelpositionen aufrufen.

Gespeichert werden die im Rechner bestätigten Stückpreise, auch wenn sie vom Produktstandard abweichen oder dieser zwischenzeitlich geändert wurde. Der Verlauf behält diese Preise dauerhaft bei. „Rechner zurücksetzen“, ein Richtungswechsel und erfolgreiches Speichern entfernen individuelle Preise und belegen die Felder wieder mit den jeweiligen Produktpreisen. Wiederholtes Absenden derselben Buchung erzeugt keine Doppelbuchung.

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
