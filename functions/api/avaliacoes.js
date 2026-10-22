// GET  /api/avaliacoes                 → notas aprovadas (site)
// GET  /api/avaliacoes?pedido=ID&t=TOK → itens do pedido e o que já foi avaliado (página de avaliação)
// POST /api/avaliacoes {id, t, itens:[{produto, cor, nota, texto}]}
import { json, erro, pronto, buscarPedido } from "../../server/loja.js";
import { resumoPublico, enviar, doPedido, podeAvaliar } from "../../server/avaliacoes.js";

export const onRequestGet = async ({ env, request }) => {
  if (!pronto(env)) return json({ produtos: {}, loja: null });
  const u = new URL(request.url), id = u.searchParams.get("pedido");
  if (id) {
    const p = await buscarPedido(env, id).catch(() => null);
    if (!p || p.token !== String(u.searchParams.get("t") || "")) return erro("Pedido não encontrado.", 404);
    return json({ pedido: { id: p.id, nome: String(p.nome || "").split(" ")[0], status: p.status, pode: podeAvaliar(p),
      itens: (p.itens || []).map(i => ({ produto: i.nome, cor: i.cor, foto: i.foto || "" })) }, feitas: await doPedido(env, p) });
  }
  try {
    const r = await resumoPublico(env);
    return new Response(JSON.stringify(r), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" } });
  } catch { return json({ produtos: {}, loja: null }); }
};

export const onRequestPost = async ({ env, request }) => {
  if (!pronto(env)) return erro("Loja não configurada.", 503);
  let b; try { b = await request.json(); } catch { return erro("Dados inválidos."); }
  try { const n = await enviar(env, b.id, b.t, b.itens); return json({ ok: true, enviadas: n }); }
  catch (e) { return erro(e.message || "Não consegui salvar a avaliação."); }
};
