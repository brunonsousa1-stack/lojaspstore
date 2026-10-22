// SP Store · registro anônimo de navegação para a aba Análise do painel.
// Guarda só ids aleatórios do navegador (nada de nome, e-mail ou IP).
(function () {
  const L = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const DONO = L("spstore_admin") === "1"; // visitas do dono não contam na Análise da loja (o Pixel do Meta continua funcionando)
  const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9-]/gi, "");
  const agora = Date.now();

  let vid = L("spstore_vid"); if (!vid) { vid = novoId(); L("spstore_vid", vid); }
  let sess = null; try { sess = JSON.parse(L("spstore_sess") || "null"); } catch (e) {}
  const ref = document.referrer ? new URL(document.referrer, location.href) : null;
  const interno = ref && ref.host === location.host;
  const nova = !sess || agora - sess.t > 30 * 60 * 1000;
  if (nova) sess = { id: novoId(), t: agora, vistos: [] };
  sess.t = agora;

  function origem() {
    const q = new URLSearchParams(location.search);
    const u = (q.get("utm_source") || "").toLowerCase();
    const mapa = { ig: "instagram", insta: "instagram", fb: "facebook", wa: "whatsapp", zap: "whatsapp", ml: "mercadolivre", gg: "google" };
    if (u) return (mapa[u] || u).slice(0, 30);
    if (q.get("gclid")) return "google";
    if (q.get("fbclid")) return "instagram/facebook";
    if (!ref || interno) return "direto";
    const h = ref.host.toLowerCase();
    const regras = [[/instagram/, "instagram"], [/facebook|fb\.|messenger/, "facebook"], [/google\./, "google"], [/bing\.|yahoo\.|duckduckgo/, "outras buscas"],
      [/whatsapp|wa\.me|l\.wl\.co/, "whatsapp"], [/mercadoli[vb]re|mlstatic/, "mercadolivre"], [/tiktok/, "tiktok"], [/youtube|youtu\.be/, "youtube"], [/shopee/, "shopee"], [/t\.co$|twitter|x\.com/, "x/twitter"]];
    for (const [re, n] of regras) if (re.test(h)) return n;
    return "outros sites";
  }
  const ua = navigator.userAgent;
  const disp = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "celular" : "computador";

  let fila = [], tm = null;
  function enviar() {
    clearTimeout(tm); tm = null;
    if (DONO) { fila.length = 0; return; }
    if (!fila.length) return;
    const corpo = JSON.stringify({ v: vid, s: sess.id, e: fila.splice(0, 40) });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon("/api/ev", new Blob([corpo], { type: "text/plain" })))) fetch("/api/ev", { method: "POST", body: corpo, keepalive: true }).catch(() => {}); } catch (e) {}
    if (fila.length) enviar();
  }
  // ---- Pixel do Meta e Google Analytics (só se os códigos estiverem no painel) ----
  const px = { fb: false, ga: false, fila: [] };
  // mesma identificação do catálogo (/api/google-shopping): SKU da cor, ou nome-cor
  const slugId = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cid = (nome, cor, sku) => sku ? String(sku) : `${slugId(nome)}-${slugId(cor || "Padrão")}`.slice(0, 50);
  function pxEnviar(nome, d) {
    d = d || {};
    const ids = d.itens ? d.itens.map(i => cid(i.nome, i.cor, i.sku)) : d.p ? [cid(d.p, d.c, d.sku)] : undefined;
    const contents = d.itens ? d.itens.map(i => ({ id: cid(i.nome, i.cor, i.sku), quantity: i.qtd || 1 })) : ids ? [{ id: ids[0], quantity: d.q || 1 }] : undefined;
    const val = Number(d.val) || undefined, item = d.itens ? d.itens.map(i => ({ item_id: cid(i.nome, i.cor, i.sku), item_name: i.nome, item_variant: i.cor, price: i.preco, quantity: i.qtd || 1 })) : d.p ? [{ item_id: cid(d.p, d.c, d.sku), item_name: d.p, item_variant: d.c, price: val, quantity: d.q || 1 }] : undefined;
    const FB = { produto: "ViewContent", carrinho: "AddToCart", checkout: "InitiateCheckout", pago: "Purchase" };
    const GA = { produto: "view_item", carrinho: "add_to_cart", checkout: "begin_checkout", pago: "purchase" };
    try { if (px.fb && FB[nome]) window.fbq("track", FB[nome], { content_ids: ids, contents, content_name: d.p, content_type: "product", value: val, currency: "BRL", ...(d.id ? { order_id: String(d.id) } : {}) }, d.id ? { eventID: "pedido-" + d.id } : undefined); } catch (e) {}
    try { if (px.ga && GA[nome]) window.gtag("event", GA[nome], { currency: "BRL", value: val, items: item, ...(d.id ? { transaction_id: String(d.id) } : {}) }); } catch (e) {}
  }
  function px_(nome, d) { if (px.pronto) pxEnviar(nome, d); else px.fila.push([nome, d]); }
  fetch("/data/loja.json").then(r => r.ok ? r.json() : {}).then(L => {
    const fbId = String(L.meta_pixel_id || "").replace(/\D/g, ""), gaId = String(L.ga4_id || "").trim().toUpperCase();
    if (fbId) {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", fbId); window.fbq("track", "PageView"); px.fb = true;
    }
    if (/^G-[A-Z0-9]{4,}$/.test(gaId)) {
      const s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + gaId; document.head.appendChild(s);
      window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date()); window.gtag("config", gaId); px.ga = true;
    }
    px.pronto = true; px.fila.splice(0).forEach(([n, d]) => pxEnviar(n, d));
  }).catch(() => { px.pronto = true; });

  function ev(t, d) {
    d = d || {};
    if (t === "produto" || t === "carrinho" || t === "checkout") px_(t, d);
    if (d.itens) d = { ...d, itens: undefined };
    if (t === "impressao") { const k = "i:" + d.p; if (sess.vistos.includes(k)) return; sess.vistos.push(k); if (sess.vistos.length > 300) sess.vistos.shift(); }
    fila.push({ t, p: d.p, c: d.c, q: d.q, val: d.val, o: d.o, d: d.d, pg: location.pathname });
    L("spstore_sess", JSON.stringify(sess));
    if (!tm) tm = setTimeout(enviar, 2000);
  }
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") enviar(); });
  addEventListener("pagehide", enviar);

  // uma "visita" por página aberta; a origem vale para a sessão inteira
  if (nova || !sess.o) sess.o = origem();
  ev("visita", { o: sess.o, d: disp });

  // produtos que apareceram na tela (para o CTR da vitrine)
  let obs = null;
  if ("IntersectionObserver" in window) obs = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && e.intersectionRatio >= 0.5) { const n = e.target.getAttribute("data-nome"); if (n) ev("impressao", { p: n }); obs.unobserve(e.target); }
  }), { threshold: [0.5] });
  function observar(raiz) { if (!obs) return; (raiz || document).querySelectorAll("[data-nome]:not([data-obs])").forEach(el => { el.setAttribute("data-obs", "1"); obs.observe(el); }); }

  window.SPA = { ev, observar, px: px_ };
})();
