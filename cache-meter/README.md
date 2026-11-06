# cache-meter

Schmale Leiste unter dem Eingabefeld von Claude Code im Terminal:

    cache 60m ■■■■■■■■■■■■■■■■■■■■ 93% hit · ☀️ Kontext 9% (Auto-Compact 83%) [ Compact ] ▾

- **Cache-Restzeit** ab der letzten Antwort, mit der echten Laufzeit der Session (5 Minuten oder 1 Stunde). Balken aus 20 Kästchen: grün, im letzten Viertel gelb, in den letzten 10 % rot, bei 0 `abgelaufen`. Wird jede Minute neu gezeichnet.
- **Hit-Rate** der letzten Antwort: Anteil der Input-Tokens aus dem Cache.
- **Wetter** relativ zur Auto-Compact-Schwelle: ☀️ bis zur Hälfte, 🌧️ bis 80 %, ⛈️ darüber. Ist keine Schwelle lesbar, gilt 83 % (angezeigt als `~83%`).
- **Compact**: wie `/compact`, bei ⛈️ hervorgehoben. Während Claude arbeitet, wird `/compact` eingereiht.
- **Pfeil**: klappt auf Wetter, Restzeit und Kontext zusammen.

Nach `/compact` oder dem Button stehen die Tokens vorher und nachher und die Zusammenfassung im Chat, als Log-Zeilen, die das Modell nicht liest.

**Bedienung:** `[ Compact ]` und den Pfeil anklicken. Unter dem Eingabefeld gibt es keinen Tastaturfokus; per Tastatur komprimiert `/compact`, und `/meter-fold` klappt die Leiste zu oder auf.

**Ändern:** Dateien hier bearbeiten, dann `/reload-plugins`. Tests: `claude plugin test <dieser Ordner>`.
