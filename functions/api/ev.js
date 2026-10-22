// Recebe os eventos de navegação do site (anônimos) para a aba Análise do painel.
import { pronto, sb } from "../../server/loja.js";

const TIPOS = new Set(["visita", "impressao", "produto", "carrinho", "checkout", "pedido"]);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse|pingdom|monitor/i;
const t = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u001f]/g, "").trim().slice(0, n) || null);
const ok = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export const onRequestPost = async ({ env, request }) => {
  if (!pronto(env) || BOT.test(request.headers.get("user-agent") || "")) return ok();
  let d; try { d = JSON.parse(await request.text()); } catch { return ok(); }
  const lista = (Array.isArray(d.e) ? d.e : []).slice(0, 40);
  const vis = t(d.v, 40), ses = t(d.s, 40);
  if (!vis || !ses || !/^[a-z0-9-]+$/i.test(vis + ses)) return ok();
  const linhas = lista.filter(x => x && TIPOS.has(x.t)).map(x => ({
    tipo: x.t, visitante: vis, sessao: ses,
    produto: t(x.p, 120), cor: t(x.c, 60),
    qtd: Number.isFinite(+x.q) && +x.q > 0 ? Math.min(99, Math.floor(+x.q)) : null,
    valor: Number.isFinite(+x.val) && +x.val >= 0 ? Math.min(100000, Math.round(+x.val * 100) / 100) : null,
    origem: x.t === "visita" ? t(x.o, 30) : null,
    dispositivo: x.t === "visita" ? t(x.d, 20) : null,
    pagina: t(x.pg, 120),
  }));
  if (linhas.length) {
    // sem a tabela criada ainda: ignora em silêncio
    try { await sb(env, "eventos", { method: "POST", body: JSON.stringify(linhas), headers: { prefer: "return=minimal" } }); } catch {}
  }
  return ok();
};
