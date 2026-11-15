import { cp, mkdir, writeFile } from "node:fs/promises";

const destination = "chat-preview-dist";
await mkdir(`${destination}/assets`, { recursive: true });
await cp("assets/chat", `${destination}/assets/chat`, { recursive: true });

for (const [file, bot, name, lang] of [
  ["index.html", "sakireem", "Sakireem Digital Solutions", "en"],
  ["es.html", "sakireem", "Sakireem Digital Solutions", "es"],
  ["hvac.html", "hvac-arizona-valley", "HVAC Arizona Valley", "en"]
]) {
  await writeFile(`${destination}/${file}`, `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${name} chat preview</title>
  <script src="/assets/chat/widget.js" data-bot="${bot}" data-preview="hosted" defer></script>
</head>
<body style="font: 1rem system-ui; margin: 2rem; color: #15304a">
  <h1>${name}</h1>
  <nav aria-label="Chat previews">
    <a href="/">Sakireem (English)</a> · <a href="/es.html">Sakireem (Español)</a> ·
    <a href="/hvac.html">HVAC Arizona Valley</a>
  </nav>
</body>
</html>`);
}
