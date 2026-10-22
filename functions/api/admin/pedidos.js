import { json, erro, usuario, ehAdmin, sb, publico, buscarPedido, atualizarPeloAdmin, pronto, catalogo, lerConfig } from "../../../server/loja.js";
import { distanciaBase } from "../../../server/geo.js";
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
    // distância até a base para pedidos que ainda não têm (pedidos antigos)
    const falta = lista.filter(p => p.endereco && p.endereco.cep && !(p.envio && p.envio.dist_base) && p.status !== "cancelado").slice(0, 8);
    if (falta.length) {
      try {
        const [{ loja }, rem] = await Promise.all([catalogo(request, env), lerConfig(env, "remetente").catch(() => null)]);
        await Promise.all(falta.map(async p => {
          const d = await distanciaBase(env, sb, loja, p.endereco, rem && rem.cep).catch(() => null);
          if (!d) return;
          p.envio = { ...(p.envio || {}), dist_base: d };
          await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ envio: p.envio }), headers: { prefer: "return=minimal" } }).catch(() => {});
        }));
      } catch {}
    }
    return json({ pedidos: lista.map(p => ({ ...publico(p), mp_pagamento: p.mp_pagamento || "", mp_status: p.mp_status || "", cpf: p.cpf || "", envio_completo: p.envio || null })) });
  } catch (e) { return erro("Erro ao buscar os pedidos.", 500); }
};
export const onRequestPost = async ({ env, request }) => {
  const [, bloqueio] = await guarda(env, request); if (bloqueio) return bloqueio;
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  const p = await buscarPedido(env, b.id);
  if (!p) return erro("Pedido não encontrado.", 404);
  try { const n = await atualizarPeloAdmin(env, request, p, b); return json({ ok: true, pedido: { ...publico(n), cpf: n.cpf || "", envio_completo: n.envio || null } }); }
  catch (e) { return erro(e.message || "Erro ao atualizar.", 400); }
};
