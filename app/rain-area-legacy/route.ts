export const dynamic = "force-dynamic";

export function GET() {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Zona de Precipitação - Nuvem Digital</title>

  <style>
    @font-face {
      font-family: "Cloud";
      src: url("/fonts/Cloud24-Reg.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: "Cloud";
      src: url("/fonts/Cloud24-Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: #172033;
      font-family: Arial, Helvetica, sans-serif;
      background: linear-gradient(160deg, #dff5ff 0%, #eef9ff 48%, #ffffff 100%);
    }

    main {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 24px;
    }

    header {
      text-align: center;
      padding-top: 8px;
      z-index: 2;
    }

    header p {
      margin: 0 0 8px;
      color: #0369a1;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    header h1 {
      width: 92vw;
      margin: 0 auto;
      font-family: "Cloud", Arial, sans-serif;
      font-size: 72px;
      line-height: 0.95;
      letter-spacing: -0.04em;
    }

    #field {
      position: relative;
      flex: 1;
      width: 96vw;
      margin: 0 auto;
      overflow: hidden;
    }

    .word {
      position: absolute;
      left: 50%;
      top: 50%;
      color: #075985;
      font-weight: 900;
      line-height: 0.95;
      letter-spacing: -0.04em;
      text-align: center;
      white-space: normal;
      text-shadow: 0 8px 24px rgba(255,255,255,0.9);
      transform: translate(-50%, -50%);
      animation: floatWord 5.2s ease-in-out infinite;
    }

    @keyframes floatWord {
      0%, 100% {
        margin-left: -8px;
        margin-top: 0;
      }

      50% {
        margin-left: 8px;
        margin-top: -10px;
      }
    }

    footer {
      min-height: 34px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      color: rgba(23, 32, 51, 0.62);
      font-size: 14px;
      font-weight: 800;
    }

    footer strong {
      color: #0369a1;
    }

    .center-message {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-family: "Cloud", Arial, sans-serif;
      font-size: 82px;
      line-height: 0.95;
      letter-spacing: -0.04em;
      padding: 24px;
    }

    .muted {
      color: rgba(23,32,51,.55);
    }

    .message {
      color: rgba(23,32,51,0.55);
      font-weight: 800;
      text-align: center;
      margin-top: 18vh;
    }
  </style>
</head>

<body>
  <main id="app">
    <header>
      <p id="cloudTitle">Nuvem Digital</p>
      <h1 id="cloudQuestion">Carregando...</h1>
    </header>

    <section id="field">
      <p class="message">Buscando ideias em precipitação...</p>
    </section>

    <footer id="footer">
      <strong id="weather">Carregando clima...</strong>
      <span id="stats"></span>
    </footer>
  </main>

  <script>
    var lastSignature = "";

    function showSunny() {
      document.body.innerHTML =
        '<main class="center-message"><section>Dia ensolarado;<br><span class="muted">sem nuvens.</span></section></main>';
    }

    function showError(message) {
      document.body.innerHTML =
        '<main class="center-message"><section>Erro ao carregar<br><span class="muted">' +
        String(message) +
        '</span></section></main>';
    }

    function getWeather(total) {
      if (total === 0) return "Sem ideias";
      if (total < 5) return "Nublado";
      if (total < 15) return "Chuva de ideias";
      if (total < 30) return "Tempestade de ideias";
      return "Temporal criativo";
    }

    function hashText(value) {
      var hash = 0;

      for (var i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash = hash | 0;
      }

      return Math.abs(hash);
    }

    function safeClamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function render(data) {
      if (!data || !data.ok) {
        showError(data && data.error ? data.error : "snapshot indisponível");
        return;
      }

      if (!data.activeCloudId || !data.cloud) {
        showSunny();
        return;
      }

      var cloud = data.cloud;
      var words = data.words || [];

      var signature = JSON.stringify({
        cloud: cloud,
        words: words
      });

      if (signature === lastSignature) return;
      lastSignature = signature;

      document.getElementById("cloudTitle").textContent =
        cloud.title || "Nuvem Digital";

      document.getElementById("cloudQuestion").textContent =
        cloud.publicTitle || "Chuva de ideias";

      var field = document.getElementById("field");
      field.innerHTML = "";

      var total = 0;
      var max = 1;

      for (var i = 0; i < words.length; i++) {
        total += words[i].count;
        if (words[i].count > max) max = words[i].count;
      }

      if (words.length === 0) {
        field.innerHTML = '<p class="message">Aguardando as primeiras ideias...</p>';
      }

      var columns = words.length <= 8 ? 4 : words.length <= 18 ? 6 : 8;
      var rows = Math.max(1, Math.ceil(words.length / columns));

      for (var j = 0; j < words.length; j++) {
        var word = words[j];
        var hash = hashText(word.id + word.text + j);

        var col = j % columns;
        var row = Math.floor(j / columns);

        var x = ((col + 0.5) / columns) * 100;
        var y = 12 + ((row + 0.5) / rows) * 74;

        x += ((hash % 100) / 100 - 0.5) * 8;
        y += (((hash >> 3) % 100) / 100 - 0.5) * 8;

        var relative = max > 1 ? Math.log(1 + word.count) / Math.log(1 + max) : 0;
        var unique = words.length;

        var minSize = unique <= 8 ? 26 : unique <= 18 ? 22 : 18;
        var maxSize = unique <= 8 ? 90 : unique <= 18 ? 66 : 48;

        var size = minSize + relative * (maxSize - minSize);

        if (word.text.length > 18) size *= 0.82;
        if (word.text.length > 28) size *= 0.72;

        var element = document.createElement("span");
        element.className = "word";
        element.textContent = word.text;
        element.style.left = safeClamp(x, 12, 88) + "%";
        element.style.top = safeClamp(y, 14, 86) + "%";
        element.style.fontSize = size + "px";
        element.style.animationDelay = "-" + ((hash % 40) / 10) + "s";

        field.appendChild(element);
      }

      document.getElementById("weather").textContent = getWeather(total);
      document.getElementById("stats").textContent =
        total + " evaporações · " + words.length + " ideias únicas";
    }

    function loadRain() {
      fetch("/api/rain-snapshot?t=" + Date.now(), {
        cache: "no-store"
      })
        .then(function(response) {
          return response.json();
        })
        .then(function(data) {
          render(data);
        })
        .catch(function(error) {
          showError(error && error.message ? error.message : error);
        });
    }

    loadRain();
    setInterval(loadRain, 4000);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}