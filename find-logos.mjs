// Quick script to find logos/favicons for feeds missing profile_photo
const feeds = [
  { key: "cdm", url: "https://cdm.link" },
  { key: "perfect_circuit", url: "https://www.perfectcircuit.com" },
  { key: "synthtopia", url: "https://www.synthtopia.com" },
  { key: "natwelch", url: "https://writing.natwelch.com" },
  { key: "chronogram", url: "https://www.chronogram.com" },
  { key: "propublica", url: "https://www.propublica.org" },
  { key: "highlands_current", url: "https://highlandscurrent.org" },
  { key: "the_verge", url: "https://www.theverge.com" },
  { key: "hundred_rabbits", url: "https://100r.co" },
  { key: "mcsweeneys", url: "https://www.mcsweeneys.net" },
  { key: "drew_devault", url: "https://drewdevault.com" },
  { key: "dropbox_tech", url: "https://dropbox.tech" },
  { key: "eli_bendersky", url: "https://eli.thegreenplace.net" },
  { key: "eliran_turgeman", url: "https://www.16elt.com" },
  { key: "danluu", url: "https://danluu.com" },
  { key: "julia_evans", url: "https://jvns.ca" },
  { key: "marc_dougherty", url: "https://www.marcdougherty.com" },
  { key: "eatonphil", url: "https://notes.eatonphil.com" },
  { key: "purplesyringa", url: "https://purplesyringa.moe" },
  { key: "spotify_engineering", url: "https://engineering.atspotify.com" },
  { key: "paul_anthony_webb", url: "https://blog.webb.page" },
  { key: "transactional", url: "https://transactional.blog" },
];

async function findIcons(key, url) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; logo-finder/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { key, url, error: `HTTP ${resp.status}` };
    const html = await resp.text();
    const icons = [];

    // Look for apple-touch-icon
    const ati = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
    if (ati) icons.push({ type: "apple-touch-icon", href: new URL(ati[1], url).href });

    // Look for og:image
    const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (og) icons.push({ type: "og:image", href: new URL(og[1], url).href });

    // Look for icon/shortcut icon
    const fav = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
    if (fav) icons.push({ type: "favicon", href: new URL(fav[1], url).href });

    // Also check reverse order (href before rel)
    const fav2 = html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    if (fav2) icons.push({ type: "favicon-alt", href: new URL(fav2[1], url).href });

    const ati2 = html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i);
    if (ati2) icons.push({ type: "apple-touch-icon-alt", href: new URL(ati2[1], url).href });

    return { key, url, icons };
  } catch (e) {
    return { key, url, error: e.message };
  }
}

const results = await Promise.allSettled(feeds.map((f) => findIcons(f.key, f.url)));
for (const r of results) {
  const val = r.status === "fulfilled" ? r.value : { key: "?", error: r.reason };
  console.log(`\n=== ${val.key} (${val.url}) ===`);
  if (val.error) {
    console.log(`  ERROR: ${val.error}`);
  } else if (val.icons?.length) {
    for (const icon of val.icons) {
      console.log(`  ${icon.type}: ${icon.href}`);
    }
  } else {
    console.log(`  No icons found`);
  }
}
