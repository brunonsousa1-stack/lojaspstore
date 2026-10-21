import { json, erro, usuario, ehAdmin, sb, publico, buscarPedido, atualizarPeloAdmin, pronto } from "../../../server/loja.js";
const guarda = async (env, request) => {
  if (!pronto(env)) return [null, erro("Loja não configurada.", 503)];
  const u = await usuario(env, request);
  if (!u) return [null, erro("Entre com o e-mail da loja.", 401)];
  if (!ehAdmin(env, u)) return [null, erro("Esta conta não tem acesso ao painel de pedidos.", 403)];
  return [u, null];
};
export const onRequestGet = async ({ env, request }) => {
  const [, bloqueio] = await guarda(env, request); if (bloqueio) return bloqueio;
  try {
    const url = new URL(request.url);
    const st = url.searchParams.get("status");
    const filtro = st && /^[a-z_]+$/.test(st) ? `&status=eq.${st}` : "";
    const lista = await sb(env, `pedidos?select=*&order=id.desc&limit=300${filtro}`, { method: "GET" });
    return json({ pedidos: lista.map(p => ({ ...publico(p), mp_pagamento: p.mp_pagamento || "", mp_status: p.mp_status || "" })) });
  } catch (e) { return erro("Erro ao buscar os pedidos.", 500); }
};
export const onRequestPost = async ({ env, request }) => {
  const [, bloqueio] = await guarda(env, request); if (bloqueio) return bloqueio;
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  const p = await buscarPedido(env, b.id);
  if (!p) return erro("Pedido não encontrado.", 404);
  try { const n = await atualizarPeloAdmin(env, request, p, b); return json({ ok: true, pedido: publico(n) }); }
  catch (e) { return erro(e.message || "Erro ao atualizar.", 400); }
};
