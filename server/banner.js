// Banner do topo já no HTML (sem esperar o JavaScript): a imagem começa a baixar na hora,
// com largura e altura reservadas, e a página não "pula" quando ela aparece.
// O JavaScript da loja continua fazendo a mesma coisa depois (não muda nada visualmente).

const attr = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// lê largura x altura dos primeiros bytes de um WebP, PNG ou JPEG
function medidas(b) {
  const u8 = new Uint8Array(b), s = (i, n) => String.fromCharCode(...u8.slice(i, i + n));
  if (u8.length >= 30 && s(0, 4) === "RIFF" && s(8, 4) === "WEBP") {
    const t = s(12, 4);
    if (t === "VP8X") return [1 + (u8[24] | u8[25] << 8 | u8[26] << 16), 1 + (u8[27] | u8[28] << 8 | u8[29] << 16)];
    if (t === "VP8 ") return [(u8[26] | u8[27] << 8) & 0x3fff, (u8[28] | u8[29] << 8) & 0x3fff];
    if (t === "VP8L") { const v = u8[21] | u8[22] << 8 | u8[23] << 16 | u8[24] << 24; return [1 + (v & 0x3fff), 1 + ((v >>> 14) & 0x3fff)]; }
  }
  if (u8.length >= 24 && u8[0] === 0x89 && s(1, 3) === "PNG") { const dv = new DataView(b); return [dv.getUint32(16), dv.getUint32(20)]; }
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const m = u8[i + 1], len = u8[i + 2] << 8 | u8[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [u8[i + 7] << 8 | u8[i + 8], u8[i + 5] << 8 | u8[i + 6]];
      i += 2 + len;
    }
  }
  return null;
}

async function tamanho(url, origem, env) {
  try {
    const u = new URL(url, origem);
    const r = u.origin === origem && env && env.ASSETS
      ? await env.ASSETS.fetch(new Request(u.toString()))
      : await fetch(u.toString(), { headers: { range: "bytes=0-65535" }, cf: { cacheEverything: true, cacheTtl: 86400 } });
    if (!r.ok && r.status !== 206) return null;
    const buf = await r.arrayBuffer();
    return medidas(buf.slice(0, 65536));
  } catch { return null; }
}

// html = index.html; loja = data/loja.json; cat = "oculos" | "relogios" | "" (mesma regra do index.html)
export async function aplicarBanner(html, loja, cat, origem, env) {
  try {
    // página inicial: no lugar do banner grande ficam os banners Óculos Masculinos e Óculos Femininos (index.html)
    if (!cat) return html;
    const L = loja || {};
    const bd = cat ? (L["banner_" + cat] || "") : (L.banner_imagem || "");
    const bm = cat ? (L["banner_" + cat + "_celular"] || "") : (L.banner_imagem_celular || "");
    if (!bd && !bm) return html;
    const desk = bd || bm, cel = bm || bd;
    const [dd, dm] = await Promise.all([tamanho(desk, origem, env), cel === desk ? null : tamanho(cel, origem, env)]);
    const wh = d => d ? ` width="${d[0]}" height="${d[1]}"` : "";
    const alt = [L.banner_titulo, L.banner_etiqueta].filter(Boolean).join(" · ") || "SP Store";
    const antes = `<a class="hero-img" id="hero-img" href="#vitrine" hidden><picture><source media="(max-width:760px)" id="hero-img-m"><img id="hero-img-d" alt=""></picture></a>`;
    if (!html.includes(antes)) return html;
    const depois = `<a class="hero-img" id="hero-img" href="#vitrine"><picture><source media="(max-width:760px)" id="hero-img-m" srcset="${attr(cel)}"${wh(dm || dd)}><img id="hero-img-d" src="${attr(desk)}" alt="${attr(alt)}"${wh(dd)} fetchpriority="high" decoding="async"></picture></a>`;
    html = html.replace(antes, depois).replace(`<section class="hero" id="topo">`, `<section class="hero" id="topo" hidden>`);
    const pre = cel === desk
      ? `<link rel="preload" as="image" href="${attr(desk)}" fetchpriority="high">`
      : `<link rel="preload" as="image" href="${attr(cel)}" media="(max-width:760px)" fetchpriority="high"><link rel="preload" as="image" href="${attr(desk)}" media="(min-width:761px)" fetchpriority="high">`;
    return html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n${pre}`);
  } catch { return html; }
}

export async function lerLoja(origem, env) {
  try {
    const r = env && env.ASSETS ? await env.ASSETS.fetch(new Request(origem + "/data/loja.json")) : await fetch(origem + "/data/loja.json");
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}
