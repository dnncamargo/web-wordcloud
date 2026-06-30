export const dynamic = "force-dynamic";

export function GET() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
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
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      color: #172033;
      background:
        radial-gradient(circle at 20% 10%, rgba(255,255,255,0.95), transparent 32%),
        linear-gradient(160deg, #dff5ff 0%, #eef9ff 45%, #ffffff 100%);
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
      font-size: clamp(40px, 7vw, 92px);
      line-height: 0.92;
      letter-spacing: -0.06em;
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
      line-height: 0.92;
      letter-spacing: -0.04em;
      text-align: center;
      white-space: normal;
      text-shadow: 0 8px 24px rgba(255,255,255,0.9);
      transform: translate(-50%, -50%);
      animation: floatWord 5.2s ease-in-out infinite;
    }

    @keyframes floatWord {
      0%, 100% {
        margin-left: -10px;
        margin-top: 0;
      }

      50% {
        margin-left: 10px;
        margin-top: -12px;
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

    .sunny {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-family: "Cloud", Arial, sans-serif;
      font-size: clamp(48px, 9vw, 120px);
      line-height: 0.9;
      letter-spacing: -0.06em;
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
    var PROJECT_ID = ${JSON.stringify(projectId)};
    var API_KEY = ${JSON.stringify(apiKey)};
    var lastSignature = "";

    function firestoreUrl(path) {
      return "https://firestore.googleapis.com/v1/projects/" +
        PROJECT_ID +
        "/databases/(default)/documents/" +
        path +
        "?key=" +
        API_KEY;
    }

    function getString(fields, key) {
      if (!fields || !fields[key]) return "";
      return fields[key].stringValue || "";
    }

    function getNumber(fields, key) {
      if (!fields || !fields[key]) return 0;
      return Number(fields[key].integerValue || fields[key].doubleValue || 0);
    }

    function showSunny() {
      document.body.innerHTML =
        '<main class="sunny"><section>Dia ensolarado;<br><span style="color:rgba(23,32,51,.55)">sem nuvens.</span></section></main>';
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

    function render(cloud, words) {
      var signature = JSON.stringify({
        title: cloud.title,
        question: cloud.publicTitle,
        words: words
      });

      if (signature === lastSignature) return;
      lastSignature = signature;

      document.getElementById("cloudTitle").textContent = cloud.title || "Nuvem Digital";
      document.getElementById("cloudQuestion").textContent = cloud.publicTitle || "Chuva de ideias";

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
        element.style.left = Math.max(10, Math.min(90, x)) + "%";
        element.style.top = Math.max(14, Math.min(86, y)) + "%";
        element.style.fontSize = size + "px";
        element.style.animationDelay = "-" + ((hash % 40) / 10) + "s";

        field.appendChild(element);
      }

      document.getElementById("weather").textContent = getWeather(total);
      document.getElementById("stats").textContent =
        total + " evaporações · " + words.length + " ideias únicas";
    }

    function loadRain() {
      fetch(firestoreUrl("settings/global"))
        .then(function(response) {
          if (!response.ok) throw new Error("settings/global não lido");
          return response.json();
        })
        .then(function(settingsDoc) {
          var fields = settingsDoc.fields || {};
          var activeCloudId = getString(fields, "activeCloudId");

          if (!activeCloudId) {
            showSunny();
            return null;
          }

          return Promise.all([
            fetch(firestoreUrl("clouds/" + activeCloudId)).then(function(response) {
              return response.json();
            }),
            fetch(firestoreUrl("clouds/" + activeCloudId + "/words")).then(function(response) {
              return response.json();
            })
          ]);
        })
        .then(function(result) {
          if (!result) return;

          var cloudDoc = result[0];
          var wordsList = result[1];

          var cloudFields = cloudDoc.fields || {};

          var cloud = {
            title: getString(cloudFields, "title"),
            publicTitle: getString(cloudFields, "publicTitle")
          };

          var documents = wordsList.documents || [];

          var words = documents.map(function(document) {
            var fields = document.fields || {};
            var nameParts = document.name.split("/");

            return {
              id: nameParts[nameParts.length - 1],
              text: getString(fields, "text"),
              count: getNumber(fields, "count") || 1
            };
          }).sort(function(a, b) {
            return b.count - a.count;
          });

          render(cloud, words);
        })
        .catch(function(error) {
          document.getElementById("cloudQuestion").textContent =
            "Erro ao carregar a precipitação";
          document.getElementById("field").innerHTML =
            '<p class="message">' + String(error.message || error) + '</p>';
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
