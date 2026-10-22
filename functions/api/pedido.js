import { json, erro, buscarPedido, publico, usuario, conferir, pronto } from "../../server/loja.js";
// GET /api/pedido?id=1001&t=<token>  (ou com login do dono do pedido)
export const onRequestGet = async ({ env, request }) => {
  if (!pronto(env)) return erro("Loja não configurada.", 503);
  try {
    const url = new URL(request.url);
    let p = await buscarPedido(env, url.searchParams.get("id"));
    if (!p) return erro("Pedido não encontrado.", 404);
    let ok = p.token === String(url.searchParams.get("t") || "");
    if (!ok) { const u = await usuario(env, request); ok = !!(u && u.id === p.user_id); }
    if (!ok) return erro("Pedido não encontrado.", 404);
    p = await conferir(env, request, p);
    return json({ pedido: publico(p) });
  } catch (e) { return erro("Erro ao buscar o pedido.", 500); }
};
