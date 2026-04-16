/**
 * Cinemacity Scraper (FIXED)
 */
const cheerio = require("cheerio");

// Constants
const MAIN_URL = "https://cinemacity.cc";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Cookie":
    "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;",
  "Referer": MAIN_URL + "/"
};

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// atob polyfill
const atobPolyfill = (str) => {
  try {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    str = String(str).replace(/[=]+$/, "");
    if (str.length % 4 === 1) return "";

    for (
      let bc = 0, bs = 0, buffer, i = 0;
      (buffer = str.charAt(i++));
      ~buffer &&
      ((bs = bc % 4 ? bs * 64 + buffer : buffer),
      bc++ % 4)
        ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
        : 0
    ) {
      buffer = chars.indexOf(buffer);
    }

    return output;
  } catch {
    return "";
  }
};

// Fetch helper
async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    headers: options.headers || HEADERS,
    ...options
  });
  return await res.text();
}

// Quality extractor
function extractQuality(url) {
  const low = (url || "").toLowerCase();
  if (low.includes("2160p") || low.includes("4k")) return "4K";
  if (low.includes("1080p")) return "1080p";
  if (low.includes("720p")) return "720p";
  if (low.includes("480p")) return "480p";
  if (low.includes("360p")) return "360p";
  return "HD";
}

// Main scraper
function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(async (resolve) => {
    try {
      console.log(
        `[START] id=${tmdbId}, type=${mediaType}, S=${season}, E=${episode}`
      );

      const streams = [];

      // TMDB fetch
      const tmdbUrl = `https://api.themoviedb.org/3/${
        mediaType === "tv" ? "tv" : "movie"
      }/${tmdbId}?api_key=${TMDB_API_KEY}`;

      const tmdbRes = await fetch(tmdbUrl);
      const mediaInfo = await tmdbRes.json();
      const animeTitle = mediaInfo.title || mediaInfo.name;

      if (!animeTitle) return resolve([]);

      console.log("[TMDB]", animeTitle);

      // Search
      const searchUrl = `${MAIN_URL}/index.php?do=search&subaction=search&story=${encodeURIComponent(
        animeTitle
      )}`;

      const searchHtml = await fetchText(searchUrl);
      const $search = cheerio.load(searchHtml);

      let mediaUrl = null;

      $search("div.dar-short_item").each((i, el) => {
        if (mediaUrl) return;

        const anchor = $search(el).find("a[href*='.html']").first();
        if (!anchor.length) return;

        const foundTitle = anchor.text().split("(")[0].trim();
        const href = anchor.attr("href");

        if (
          foundTitle.toLowerCase().includes(animeTitle.toLowerCase()) ||
          animeTitle.toLowerCase().includes(foundTitle.toLowerCase())
        ) {
          mediaUrl = href;
          console.log("[MATCH]", href);
        }
      });

      if (!mediaUrl) return resolve([]);

      // Fetch page
      const pageHtml = await fetchText(mediaUrl);
      const $page = cheerio.load(pageHtml);

      let fileData = null;

      $page("script").each((i, el) => {
        if (fileData) return;

        const html = $page(el).html();
        if (!html || !html.includes("atob")) return;

        const regex = /atob\s*\(\s*(['"])(.*?)\1\s*\)/g;
        let match;

        while ((match = regex.exec(html)) !== null) {
          const decoded = atobPolyfill(match[2]);

          const fileMatch =
            decoded.match(/file\s*:\s*(['"])(.*?)\1/s) ||
            decoded.match(/file\s*:\s*(\[.*?\])/s) ||
            decoded.match(/sources\s*:\s*(\[.*?\])/s);

          if (fileMatch) {
            let rawFile = fileMatch[2] || fileMatch[1];

            try {
              if (
                rawFile.startsWith("[") ||
                rawFile.startsWith("{")
              ) {
                rawFile = rawFile.replace(/\\(.)/g, "$1");
                fileData = JSON.parse(rawFile);
              } else {
                fileData = rawFile;
              }
            } catch {
              fileData = rawFile;
            }

            console.log("[FILE FOUND]");
          }
        }
      });

      if (!fileData) return resolve([]);

      // Stream adder (FIXED)
      const addStream = (url, title) => {
        if (!url) return;

        if (url.includes(",")) {
          const parts = url.split(",");
          const base = parts[0];

          const master = parts.find((p) =>
            p.includes(".m3u8")
          );
          const mp4 = parts.find((p) =>
            p.includes(".mp4")
          );

          if (master) url = base + master;
          else if (mp4) url = base + mp4;
        }

        if (url.startsWith("//")) url = "https:" + url;

        streams.push({
          name: "CinemaCity",
          title,
          url,
          type: url.includes(".m3u8") ? "hls" : "mp4",

          behaviorHints: {
            notWebReady: true,
            bingeGroup: "cinemacity",
            proxyHeaders: {
              request: {
                "User-Agent": HEADERS["User-Agent"],
                Referer: MAIN_URL + "/",
                Origin: MAIN_URL,
                Cookie: HEADERS["Cookie"]
              }
            }
          }
        });
      }; // ✅ FIXED (was missing)

      const processStr = (str, title) => {
        if (!str) return;
        addStream(str, title);
      };

      // Movie handling
      if (mediaType === "movie") {
        if (Array.isArray(fileData)) {
          const obj =
            fileData.find((f) => f.file) || fileData[0];
          if (obj?.file) processStr(obj.file, animeTitle);
        } else if (typeof fileData === "string") {
          processStr(fileData, animeTitle);
        }
      }

      console.log("[DONE]", streams.length);
      return resolve(streams);
    } catch (e) {
      console.log("[ERROR]", e.message);
      return resolve([]);
    }
  });
}

module.exports = { getStreams };
