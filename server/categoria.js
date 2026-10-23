// Páginas de categoria (/oculos e /relogios): a mesma loja, já filtrada, com título e imagem próprios
// para o Google e para o link compartilhado no WhatsApp/Instagram.
import { catalogo } from "./loja.js";
import { abs } from "./seo.js";
import { aplicarBanner } from "./banner.js";

const INFO = {
  oculos: { titulo: "Óculos de sol femininos e masculinos | SP Store", desc: "Óculos de sol com proteção UV400 em vários modelos e cores. Compre 4, pague 3, 5% off no Pix e entrega hoje na Grande SP." },
  relogios: { titulo: "Relógios DK Original | SP Store", desc: "Relógios DK Original com máquina quartz: analógicos, digitais e formato gota. Compre 4, pague 3, 5% off no Pix e entrega hoje na Grande SP." },
};
const attr = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function paginaCategoria({ env, request }, cat) {
  const origem = new URL(request.url).origin;
  let html = await (await env.ASSETS.fetch(new URL("/index.html", origem))).text();
  let img = "", lojaB = {};
  try {
    const { produtos, loja } = await catalogo(request, env);
    lojaB = loja || {};
    img = loja["banner_" + cat] || loja[`categoria_${cat}_img`] || "";
    if (!img) for (const p of produtos) if (p.ativo !== false && p.categoria === cat) { const v = (p.variantes || []).find(x => x.foto); if (v) { img = v.foto; break; } }
  } catch {}
  const i = INFO[cat];
  const head = `<title>${attr(i.titulo)}</title>
<meta name="description" content="${attr(i.desc)}">
<link rel="canonical" href="${origem}/${cat}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SP Store">
<meta property="og:title" content="${attr(i.titulo)}">
<meta property="og:description" content="${attr(i.desc)}">
${img ? `<meta property="og:image" content="${attr(abs(origem, img))}">` : ""}
<meta property="og:url" content="${origem}/${cat}">
<script>window.__CAT=${JSON.stringify(cat)}</script>`;
  html = html.replace(/<title>[^<]*<\/title>/, "").replace(/<meta name="description"[^>]*>/, "").replace(/<meta property="og:[^>]*>/g, "");
  html = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n${head}`);
  html = await aplicarBanner(html, lojaB, cat, origem, env);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
}
