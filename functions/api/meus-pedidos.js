import { json, erro, usuario, sb, publico, pronto } from "../../server/loja.js";
export const onRequestGet = async ({ env, request }) => {
  if (!pronto(env)) return erro("Loja não configurada.", 503);
  try {
    const u = await usuario(env, request);
    if (!u) return erro("Entre na sua conta.", 401);
    const lista = await sb(env, `pedidos?user_id=eq.${u.id}&status=neq.cancelado&select=*&order=id.desc&limit=100`, { method: "GET" });
    const canc = await sb(env, `pedidos?user_id=eq.${u.id}&status=eq.cancelado&mp_pagamento=not.is.null&select=*&order=id.desc&limit=20`, { method: "GET" });
    const todos = [...lista, ...canc].sort((a, b) => b.id - a.id).map(publico);
    return json({ pedidos: todos, perfil: u.user_metadata || {} });
  } catch (e) { return erro("Erro ao buscar seus pedidos.", 500); }
};
