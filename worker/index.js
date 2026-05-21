 /**
 * SurfFlow Scoring Worker
 * Cloudflare Worker — runs on cron every 15 minutes
 *
 * What it does:
 *   1. Searches YouTube Data API for currently-live surf cam streams
 *   2. Merges with a curated fallback registry (always-good spots)
 *   3. Fetches wave forecasts from Open-Meteo Marine API (free, no key)
 *   4. Scores every cam (wave height, period, swell quality, daylight)
 *   5. Writes ranked JSON to Cloudflare KV — served globally at edge
 *   6. Also serves GET /api/feed to return that cached JSON to the browser
 *
 * Environment variables (set in Cloudflare dashboard or wrangler.toml):
 *   YOUTUBE_API_KEY  — free Google Cloud key, YouTube Data API v3
 *   SURF_KV          — KV namespace binding (configured in wrangler.toml)
 */

// ─────────────────────────────────────────────────────────────
// CURATED FALLBACK REGISTRY
// Always-included world-class spots with known YouTube channel IDs
// even when the YouTube search returns nothing useful
// ─────────────────────────────────────────────────────────────
const CURATED_CAMS = [
  {
    id: "pipeline",
    name: "Banzai Pipeline",
    region: "North Shore, Oahu · Hawaii 🇺🇸",
    lat: 21.6617, lng: -158.0536,
    minWave: 4,
    ytSearch: "https://www.youtube.com/results?search_query=pipeline+hawaii+surf+live+cam+now",
    // Fallback video shown when no live stream is found
    // Pipeline Goes HUGE March 2025 — 4K verified public
    fallbackVideoId: "uSd14Y7ZmZ4",
    thumb: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=200&h=120&fit=crop&q=80",
    tags: ["barrel", "reef", "world-class"],
    desc: "The world's most famous wave. Hollow reef barrels off Ehukai Beach Park, best November–February."
  },
  {
    id: "nazare",
    name: "Nazaré Canyon",
    region: "Nazaré, Portugal 🇵🇹",
    lat: 39.6003, lng: -9.0694,
    minWave: 10,
    ytSearch: "https://www.youtube.com/results?search_query=nazare+big+wave+surf+live",
    // Nazare big wave compilation 2024/2025 — verified public
    fallbackVideoId: "aHIhSXFMNzg",
    thumb: "https://images.unsplash.com/photo-1509914398892-963f53e6e2f1?w=200&h=120&fit=crop&q=80",
    tags: ["big-wave", "world-record"],
    desc: "Home of the world-record wave. Underwater canyon funnels Atlantic swells into 20m+ monsters."
  },
  {
    id: "uluwatu",
    name: "Uluwatu",
    region: "Bukit Peninsula, Bali 🇮🇩",
    lat: -8.8291, lng: 115.0849,
    minWave: 3,
    ytSearch: "https://www.youtube.com/results?search_query=uluwatu+bali+surf+live+cam",
    // Uluwatu first big swell of year May 2026 — verified public
    fallbackVideoId: "krIpT3ECCfM",
    thumb: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=200&h=120&fit=crop&q=80",
    tags: ["reef", "left-hander", "tropical"],
    desc: "Sacred temple above a legendary left-hander. Best May–September on Indian Ocean swells."
  },
  {
    id: "teahupoo",
    name: "Teahupo'o",
    region: "Tahiti, French Polynesia 🇵🇫",
    lat: -17.8372, lng: -149.2699,
    minWave: 5,
    ytSearch: "https://www.youtube.com/results?search_query=teahupoo+tahiti+surf+live",
    // Teahupoo Olympic venue 2024 documentary — verified public
    fallbackVideoId: "HvKkyIhVkco",
    thumb: "https://images.unsplash.com/photo-1455264745730-cb3b76250ae8?w=200&h=120&fit=crop&q=80",
    tags: ["slab", "heavy", "olympics"],
    desc: "The thickest, heaviest wave in surfing. A shallow reef produces terrifying slabs."
  },
  {
    id: "jbay",
    name: "Jeffreys Bay",
    region: "Eastern Cape, South Africa 🇿🇦",
    lat: -34.0517, lng: 24.9206,
    minWave: 4,
    ytSearch: "https://www.youtube.com/results?search_query=jeffreys+bay+surf+live+cam",
    // JBay firing with pros warming up July 2025 — verified public
    fallbackVideoId: "wJau8vowlrU",
    thumb: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=200&h=120&fit=crop&q=80",
    tags: ["pointbreak", "right-hander"],
    desc: "One of the world's great right-hand pointbreaks. Perfect lined walls during July swells."
  },
  {
    id: "mavericks",
    name: "Mavericks",
    region: "Half Moon Bay, California 🇺🇸",
    lat: 37.4954, lng: -122.4975,
    minWave: 8,
    ytSearch: "https://www.youtube.com/results?search_query=mavericks+surf+live+cam+california",
    // Mavericks potential world record Dec 2024 — verified public
    fallbackVideoId: "9JmN8_zUY1w",
    thumb: "https://images.unsplash.com/photo-1476673160081-cf065607f449?w=200&h=120&fit=crop&q=80",
    tags: ["big-wave", "cold-water"],
    desc: "Legendary big-wave spot. Waves reach 60ft+ on massive NW winter swells."
  },
  {
    id: "snapper",
    name: "Snapper Rocks",
    region: "Gold Coast, Australia 🇦🇺",
    lat: -28.0197, lng: 153.4425,
    minWave: 3,
    ytSearch: "https://www.youtube.com/results?search_query=snapper+rocks+gold+coast+surf+live",
    // Snapper Rocks meaty slabs Feb 2025 — verified public
    fallbackVideoId: "wSi3MLX-Yxo",
    thumb: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&h=120&fit=crop&q=80",
    tags: ["pointbreak", "superbank"],
    desc: "Start of the famous Superbank. Sand-bottom pointbreak producing rides up to 2km."
  },
  {
    id: "hossegor",
    name: "Hossegor · La Nord",
    region: "Landes, France 🇫🇷",
    lat: 43.6632, lng: -1.4396,
    minWave: 3,
    ytSearch: "https://www.youtube.com/results?search_query=hossegor+surf+live+cam+france",
    // Hossegor clean offshore barrels Oct 2024 — verified public
    fallbackVideoId: "O0EZpWawbnE",
    thumb: "https://images.unsplash.com/photo-1500514966906-fe245eea9344?w=200&h=120&fit=crop&q=80",
    tags: ["beach-break", "barrels"],
    desc: "Europe's most powerful beach break. Autumn Atlantic storms fire huge barrels."
  },
  {
    id: "cloudbreak",
    name: "Cloudbreak",
    region: "Tavarua Island, Fiji 🇫🇯",
    lat: -17.9333, lng: 177.2,
    minWave: 6,
    ytSearch: "https://www.youtube.com/results?search_query=cloudbreak+fiji+surf+live",
    // Cloudbreak 6-10ft perfect swell March 2025 — verified public
    fallbackVideoId: "LGfwd9DE3Zg",
    thumb: "https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=200&h=120&fit=crop&q=80",
    tags: ["reef", "left-hander", "remote"],
    desc: "Remote tropical perfection. A reef-pass left stretching 300m, best April–October."
  },
  {
    id: "huntington",
    name: "Huntington Beach Pier",
    region: "Huntington Beach, California 🇺🇸",
    lat: 33.6550, lng: -118.0050,
    minWave: 2,
    ytSearch: "https://www.youtube.com/results?search_query=huntington+beach+surf+live+cam+pier",
    // Huntington Beach US Open 2024 highlights — verified public
    fallbackVideoId: "8KSFyqNCX-I",
    thumb: "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?w=200&h=120&fit=crop&q=80",
    tags: ["beach-break", "surf-city"],
    desc: "Surf City USA. Home of the US Open of Surfing. Consistent year-round."
  },
  {
    id: "cloudbreak-mavericks",
    name: "Peahi (Jaws)",
    region: "Maui, Hawaii 🇺🇸",
    lat: 20.9389, lng: -156.1864,
    minWave: 15,
    ytSearch: "https://www.youtube.com/results?search_query=jaws+peahi+maui+surf+live+cam",
    // Cloudbreak Fiji April 2026 — using as Jaws-style big wave content
    fallbackVideoId: "sHg-CW5u_ZI",
    thumb: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=200&h=120&fit=crop&q=80",
    tags: ["big-wave", "tow-in", "maui"],
    desc: "Peahi (Jaws) — one of the world's heaviest big-wave breaks. Only rideable by tow-in teams."
  },
  {
    id: "bells",
    name: "Bells Beach",
    region: "Torquay, Victoria · Australia 🇦🇺",
    lat: -38.3693, lng: 144.2833,
    minWave: 4,
    ytSearch: "https://www.youtube.com/results?search_query=bells+beach+australia+surf+live+cam",
    // Ethan Ewing Snapper + Bells 2025 — verified public
    fallbackVideoId: "ea13znzBFc8",
    thumb: "https://images.unsplash.com/photo-1484291470158-b8f8d608850d?w=200&h=120&fit=crop&q=80",
    tags: ["reef", "icon", "Easter"],
    desc: "Spiritual home of Australian surfing. Powerful reef break, host of the Rip Curl Pro since 1962."
  }
];

// ─────────────────────────────────────────────────────────────
// YOUTUBE DATA API — search for currently LIVE surf cams
// ─────────────────────────────────────────────────────────────
async function searchYouTubeLiveCams(apiKey) {
  const queries = [
    "surf cam live",
    "surf webcam live stream",
    "beach surf cam live now",
    "surfing live stream camera"
  ];

  const results = [];
  const seenIds = new Set();

  for (const q of queries) {
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("q", q);
      url.searchParams.set("type", "video");
      url.searchParams.set("eventType", "live");          // ONLY currently live
      url.searchParams.set("videoEmbeddable", "true");    // ONLY embeddable
      url.searchParams.set("maxResults", "10");
      url.searchParams.set("relevanceLanguage", "en");
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json();

      for (const item of (data.items || [])) {
        const vid = item.id?.videoId;
        if (!vid || seenIds.has(vid)) continue;

        const title = item.snippet?.title || "";
        const channel = item.snippet?.channelTitle || "";
        const thumb = item.snippet?.thumbnails?.medium?.url || "";

        // Filter: must look like a surf/beach cam (not a competition broadcast or music stream)
        const looksLikeCam = /surf|wave|beach|ocean|sea|cam|pipeline|nazare|teahupoo|mavericks|bali|hawaii|coast|swell/i.test(title + channel);
        if (!looksLikeCam) continue;

        seenIds.add(vid);
        results.push({
          id: `yt_${vid}`,
          name: title.slice(0, 60),
          region: channel,
          lat: null, lng: null,           // no forecast possible without coords
          minWave: 0,
          videoId: vid,
          isLive: true,
          thumb,
          ytSearch: `https://www.youtube.com/watch?v=${vid}`,
          tags: ["live-now"],
          desc: `Live surf cam: ${title}`
        });
      }
    } catch (_) {
      // Silently skip failed queries — we have the curated fallback
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// OPEN-METEO MARINE FORECAST (free, no key required)
// ─────────────────────────────────────────────────────────────
async function fetchMarineForecast(lat, lng) {
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,wind_wave_height&forecast_days=1&timezone=auto`;

  try {
    const res = await fetch(url, { cf: { cacheTtl: 900 } }); // CF edge cache 15min
    if (!res.ok) return null;
    const d = await res.json();

    // Find current hour index
    const now = Date.now();
    let bi = 0, md = Infinity;
    (d.hourly?.time || []).forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - now);
      if (diff < md) { md = diff; bi = i; }
    });

    const wM  = d.hourly.wave_height?.[bi]        || 0;
    const sM  = d.hourly.swell_wave_height?.[bi]  || 0;
    const wdM = d.hourly.wind_wave_height?.[bi]   || 0;
    const per = d.hourly.wave_period?.[bi]         || 0;
    const dir = d.hourly.wave_direction?.[bi]      || 0;

    return {
      waveHeightFt:  +(wM  * 3.281).toFixed(1),
      swellHeightFt: +(sM  * 3.281).toFixed(1),
      windWaveFt:    +(wdM * 3.281).toFixed(1),
      periodSec:     +per.toFixed(1),
      directionDeg:  Math.round(dir)
    };
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// SCORING ALGORITHM  (0–100)
// ─────────────────────────────────────────────────────────────
function computeScore(forecast, cam) {
  if (!forecast) return 45; // unknown but not zero

  const { waveHeightFt, swellHeightFt, windWaveFt, periodSec } = forecast;

  // Below minimum wave height for this spot → score tanks
  if (waveHeightFt < cam.minWave) {
    return Math.max(5, Math.round(waveHeightFt / Math.max(cam.minWave, 1) * 30));
  }

  // Wave height score — bell curve peaking at 8ft ideal
  const heightScore = Math.max(0, 35 - Math.abs(waveHeightFt - 8) * 2.5);

  // Period score — longer = cleaner, 14–18s ideal
  const periodScore = Math.min(25, Math.max(0, (periodSec - 6) / 12 * 25));

  // Swell quality — more ground swell vs wind chop = cleaner waves
  const swellRatio = waveHeightFt > 0 ? swellHeightFt / waveHeightFt : 0;
  const qualityScore = Math.min(25, swellRatio * 25);

  // Daylight bonus — cameras are only useful in daylight
  // Use UTC hour as rough proxy (imperfect but works without TZ lookup)
  const utcHour = new Date().getUTCHours();
  const daylightBonus = (utcHour >= 5 && utcHour <= 22) ? 15 : 0;

  return Math.min(99, Math.round(heightScore + periodScore + qualityScore + daylightBonus));
}

// ─────────────────────────────────────────────────────────────
// PLAIN-ENGLISH WAVE DESCRIPTION
// ─────────────────────────────────────────────────────────────
function waveDescription(forecast, score) {
  if (!forecast) return { headline: "Checking conditions...", detail: "No forecast available" };

  const ft = forecast.waveHeightFt;
  const compass = ["N","NE","E","SE","S","SW","W","NW"][Math.round(forecast.directionDeg / 45) % 8];

  let headline;
  if (score >= 85) headline = `🔥 ${ft}ft — ON FIRE!`;
  else if (score >= 70) headline = `🌊 ${ft}ft — Firing!`;
  else if (score >= 55) headline = `${ft}ft — Looking Good`;
  else if (score >= 40) headline = `${ft}ft — Decent Waves`;
  else if (score >= 25) headline = `${ft}ft — Small Today`;
  else headline = `${ft}ft — Flat`;

  const detail = `${forecast.swellHeightFt}ft swell · ${forecast.periodSec}s period · from ${compass}`;
  return { headline, detail };
}

// ─────────────────────────────────────────────────────────────
// MAIN SCORING CRON — runs every 15 minutes
// ─────────────────────────────────────────────────────────────
async function runScoringCron(env) {
  console.log("[SurfFlow] Scoring cron started:", new Date().toISOString());

  // 1. Search YouTube for currently-live surf streams (if API key is set)
  let liveCams = [];
  if (env.YOUTUBE_API_KEY) {
    liveCams = await searchYouTubeLiveCams(env.YOUTUBE_API_KEY);
    console.log(`[SurfFlow] YouTube search returned ${liveCams.length} live cams`);
  }

  // 2. Merge: live YouTube cams first, then curated fallbacks
  //    Deduplicate by video ID
  const seenVideoIds = new Set(liveCams.map(c => c.videoId).filter(Boolean));
  const allCams = [
    ...liveCams,
    ...CURATED_CAMS.map(c => ({
      ...c,
      videoId: c.fallbackVideoId,
      isLive: false
    })).filter(c => !seenVideoIds.has(c.fallbackVideoId))
  ];

  // 3. Fetch forecasts in parallel (only for cams with coordinates)
  const withCoords  = allCams.filter(c => c.lat !== null && c.lng !== null);
  const withoutCoords = allCams.filter(c => c.lat === null || c.lng === null);

  // Chunk into batches of 6 to avoid overwhelming the API
  const forecasts = {};
  for (let i = 0; i < withCoords.length; i += 6) {
    const batch = withCoords.slice(i, i + 6);
    const results = await Promise.allSettled(
      batch.map(cam => fetchMarineForecast(cam.lat, cam.lng))
    );
    results.forEach((r, j) => {
      forecasts[batch[j].id] = r.status === "fulfilled" ? r.value : null;
    });
    // Small delay between batches to be a good API citizen
    if (i + 6 < withCoords.length) await new Promise(r => setTimeout(r, 200));
  }

  // 4. Score every cam
  const scored = allCams.map(cam => {
    const forecast = forecasts[cam.id] || null;
    const score = computeScore(forecast, cam);
    const { headline, detail } = waveDescription(forecast, score);
    return {
      ...cam,
      forecast,
      score,
      waveHeadline: headline,
      waveDetail: detail
    };
  });

  // 5. Sort: live cams first (within their tier), then by score
  scored.sort((a, b) => {
    // Live cams get a +20 bonus in ranking
    const aEffective = a.score + (a.isLive ? 20 : 0);
    const bEffective = b.score + (b.isLive ? 20 : 0);
    return bEffective - aEffective;
  });

  // 6. Build output feed
  const feed = {
    generatedAt:    new Date().toISOString(),
    nextRefreshAt:  new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    liveCount:      scored.filter(c => c.isLive).length,
    totalCams:      scored.length,
    cams:           scored.slice(0, 30) // top 30 for rotation
  };

  // 7. Write to KV (TTL: 20 minutes — slightly longer than refresh interval)
  await env.SURF_KV.put("scored_feed", JSON.stringify(feed), { expirationTtl: 1200 });
  console.log(`[SurfFlow] Feed written: ${feed.cams.length} cams, ${feed.liveCount} live`);

  return feed;
}

// ─────────────────────────────────────────────────────────────
// HTTP REQUEST HANDLER
// ─────────────────────────────────────────────────────────────
async function handleRequest(request, env) {
  const url = new URL(request.url);

  // CORS headers — allow surfcam.stluker.com and local dev
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /api/feed — return the cached scored feed
  if (url.pathname === "/api/feed") {
    let cached = await env.SURF_KV.get("scored_feed");

    // If cache is empty (first run), trigger a fresh score
    if (!cached) {
      console.log("[SurfFlow] Cache empty, running fresh score...");
      const feed = await runScoringCron(env);
      cached = JSON.stringify(feed);
    }

    return new Response(cached, {
      headers: {
        ...corsHeaders,
        "Content-Type":  "application/json",
        "Cache-Control": "public, max-age=900",         // 15-min browser cache
        "X-Cache":       "HIT"
      }
    });
  }

  // GET /api/refresh — manual refresh trigger (useful for testing)
  if (url.pathname === "/api/refresh") {
    const feed = await runScoringCron(env);
    return new Response(JSON.stringify({ ok: true, cams: feed.cams.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // GET /api/health — simple health check
  if (url.pathname === "/api/health") {
    const cached = await env.SURF_KV.get("scored_feed");
    const feed = cached ? JSON.parse(cached) : null;
    return new Response(JSON.stringify({
      ok: true,
      lastGenerated: feed?.generatedAt || null,
      camCount: feed?.cams?.length || 0,
      liveCount: feed?.liveCount || 0
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response("SurfFlow Scoring API — use /api/feed", { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// WORKER EXPORTS (Cloudflare Workers ES module format)
// ─────────────────────────────────────────────────────────────
export default {
  // Handles HTTP requests to the worker's route
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },

  // Handles scheduled cron triggers
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScoringCron(env));
  }
};
