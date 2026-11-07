# 8 Block Grimz – Verwaltungsportal

Ein privates, deutschsprachiges Verwaltungsportal für Member, Abgaben, Lager, Tresor, Zivis, Produkte und Kontakte. Die Anwendung wird als Node.js-/Express-Server mit SQLite betrieben und enthält eine responsive Weboberfläche.

## Funktionen

- Login mit serverseitigen Sitzungen, bcrypt-Passwort-Hashes, Rate-Limit und CSRF-Schutz
- Rollen für Inhaber, Verwalter, Mitarbeiter und Leser; Rechte je Bereich
- Benutzerverwaltung und Änderungsprotokoll
- Member, Abgaben, Lager, Tresor-Bewegungen und Zivis
- Getrennte Kontaktbücher für Fams und Zivilisten
- Produkt-Preisliste mit 32 bearbeitbaren Startplätzen
- SQLite-Datenbank und Backup-Skript

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```powershell
Set-Location C:\Users\stein\Desktop\8BG
npm ci
Copy-Item env.example .env
```

In `.env` drei unterschiedliche zufällige Werte für `SESSION_SECRET`, `SETUP_KEY` und `HEALTH_TOKEN` mit jeweils mindestens 32 Zeichen setzen. Anschließend:

```powershell
npm start
```

Öffne **http://localhost:3000**. Beim ersten Aufruf mit dem `SETUP_KEY` das Inhaber-Konto einrichten. In Entwicklung kann `npm run dev` verwendet werden; Syntaxprüfungen laufen mit `npm run check`.

## Portainer, Nginx Proxy Manager und Cloudflare

Die Portainer-Datei ist auf **https://8bg.3r6nuss.de** und das vorhandene Docker-Netzwerk **`nginx-proxy-manager_default`** eingestellt. Wenn Domain oder Netzwerk bei dir anders heißen, passe die genannten Stellen vor dem Deploy an. Port 3001 wird nicht am Host veröffentlicht; NPM erreicht den Container intern unter `http://8bg-web-1:3001`.

### 1. Image automatisch veröffentlichen

Der GitHub-Actions-Workflow testet und veröffentlicht das Docker-Image bei jedem
Push auf `main` nach **`ghcr.io/3r6nuss/8bg:latest`**. Versionstags (`v*`)
werden ebenfalls als Image-Tag veröffentlicht. Im GitHub-Repository unter
**Actions** muss der Workflow erfolgreich durchlaufen.

Beim ersten erfolgreichen Lauf wird das Paket
[`ghcr.io/3r6nuss/8bg`](https://github.com/users/3r6nuss/packages/container/package/8bg)
angelegt. Falls Portainer das Image ohne Registry-Login abrufen soll, das Paket
einmalig in GitHub unter **Package settings → Change visibility → Public**
öffentlich stellen. Das GitHub-Repository ist öffentlich; die Sichtbarkeit des
Container-Pakets wird dadurch nicht automatisch öffentlich.

### 2. Portainer-Stack bereitstellen

1. In Portainer **Stacks → Add stack** wählen und den Namen `8bg` vergeben.
2. Den Inhalt von [docker-compose.portainer.yml](./docker-compose.portainer.yml) in den Web-Editor kopieren.
3. Unter **Environment variables** drei voneinander verschiedene Werte setzen:
   - `SESSION_SECRET`
   - `SETUP_KEY`
   - `HEALTH_TOKEN`

   Jeder Wert muss mindestens 32 Zeichen lang sein. Auf dem Server lassen sich Werte mit `openssl rand -hex 32` erzeugen. Die Werte niemals in Git speichern oder veröffentlichen.
4. Den Stack deployen. Portainer zieht `ghcr.io/3r6nuss/8bg:latest` aus GHCR. Falls das Paket privat bleiben soll, zuerst in Portainer unter **Registries** ein GHCR-Zugang mit einem GitHub-Personal-Access-Token mit `read:packages` einrichten.
5. In den Container-Logs prüfen, dass das Portal startet. Der erste Einrichtungsschlüssel wird nicht automatisch angezeigt: Der im Stack gesetzte `SETUP_KEY` ist der Schlüssel für die Ersteinrichtung.

Das Portal verwendet ein neues, separates Docker-Volume **`8bg_ivy_data`**. Das vorherige Volume **`8bg_data`** wird nicht eingebunden oder gelöscht. Vor dem Entfernen oder Migrieren alter Volumes zuerst ein Backup erstellen. Das Datenvolume des neuen Portals bei Updates beibehalten; für Backups den Stack stoppen und das gesamte Volume sichern.

### 3. Nginx Proxy Manager

Einen **Proxy Host** anlegen:

- **Domain Names:** `8bg.3r6nuss.de`
- **Scheme:** `http`
- **Forward Hostname / IP:** `8bg-web-1`
- **Forward Port:** `3001`
- **SSL:** Let's Encrypt-Zertifikat anfordern und **Force SSL** aktivieren

NPM und das Portal müssen mit dem Docker-Netzwerk `nginx-proxy-manager_default` verbunden sein. Von außen nur die benötigten Ports 80 und 443 zum Proxy weiterleiten. Port 3001, Portainer und die NPM-Verwaltungsoberfläche nicht öffentlich freigeben.

### 4. Cloudflare

1. Für `8bg.3r6nuss.de` einen DNS-Record auf die öffentliche IP des Servers setzen. Einen AAAA-Record nur verwenden, wenn IPv6 korrekt eingerichtet ist.
2. Für die erstmalige Let's-Encrypt-Ausstellung Cloudflare vorübergehend auf **DNS only** (graue Wolke) stellen.
3. Nach erfolgreicher Zertifikatsausstellung Cloudflare **SSL/TLS → Full (strict)** einstellen; **Flexible** nicht verwenden. Danach kann der Proxy (orange Wolke) eingeschaltet werden.
4. Keine „Cache Everything“-Regel für das Portal einrichten und insbesondere `/api/*` nicht cachen.

Anschließend **https://8bg.3r6nuss.de** öffnen und mit dem `SETUP_KEY` das Inhaber-Konto erstellen. Falls du eine andere Domain verwendest, muss NPM den ursprünglichen Host weiterleiten; die App vergleicht bei schreibenden Anfragen den Origin mit dem Host.

### Health-Check der Serververwaltung

Der geschützte Endpunkt `https://8bg.3r6nuss.de/api/health` benötigt den Bearer-Token aus `HEALTH_TOKEN`. In der Serververwaltung setzen:

```text
BG_HEALTH_URL=https://8bg.3r6nuss.de/api/health
BG_HEALTH_TOKEN=<derselbe Wert wie HEALTH_TOKEN im 8BG-Stack>
```

Eine Cloudflare-Access-Anmeldeseite oder Browser-Challenge vor `/api/health` verhindert die automatische Abfrage. Für diesen Pfad eine passende Ausnahme konfigurieren und den Bearer-Token-Schutz der Anwendung beibehalten.

### Updates

Änderungen auf `main` starten automatisch den Test- und Image-Workflow. Sobald
der Lauf erfolgreich ist, in Portainer den Stack erneut deployen, damit
`pull_policy: always` die neue `latest`-Version abruft. Bei einem Stack aus dem
Web-Editor vorher auch dessen Compose-Datei auf den aktuellen Inhalt von
[docker-compose.portainer.yml](./docker-compose.portainer.yml) aktualisieren.
Das Volume `8bg_ivy_data` nicht entfernen. Vor dem Update ein Backup anlegen.

## Daten und Sicherheit

- SQLite-Datei und Sitzungen liegen im persistenten Verzeichnis `/app/data`.
- Lokal kann mit `npm run backup` eine SQLite-Sicherung im Datenverzeichnis erstellt werden; auf dem Server für konsistente Sicherungen den Stack vorher stoppen und das gesamte Volume sichern.
- Für den Betrieb ist eine einzelne App-Instanz mit persistentem Speicher vorgesehen; mehrere Instanzen benötigen eine zentrale Datenbank und einen gemeinsamen Session-Store.
- Passwörter werden als bcrypt-Hashes gespeichert. Sitzungs-Cookies sind `HttpOnly`, `SameSite=Lax` und in Produktion `Secure`.
- Das Portal verarbeitet personenbezogene und möglicherweise finanzielle Daten. Hosting, Datenschutz, Aufbewahrung, Zugriffe und Backups vor produktiver Nutzung prüfen.
- Den Tresor nicht als Bank- oder Zahlungsdienst verwenden. Nur zulässige Bestands- und Buchungsdaten verwalten.
