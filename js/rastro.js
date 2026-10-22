// SP Store · registro anônimo de navegação para a aba Análise do painel.
// Guarda só ids aleatórios do navegador (nada de nome, e-mail ou IP).
(function () {
  const L = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  if (L("spstore_admin") === "1") { window.SPA = { ev() {} }; return; } // visitas do dono não contam
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
    if (!fila.length) return;
    const corpo = JSON.stringify({ v: vid, s: sess.id, e: fila.splice(0, 40) });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon("/api/ev", new Blob([corpo], { type: "text/plain" })))) fetch("/api/ev", { method: "POST", body: corpo, keepalive: true }).catch(() => {}); } catch (e) {}
    if (fila.length) enviar();
  }
  function ev(t, d) {
    d = d || {};
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

  window.SPA = { ev, observar };
})();
