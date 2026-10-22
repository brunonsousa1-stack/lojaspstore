import { json, erro, buscarPedido, publico, etiqueta } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";
export const onRequestPost = async ({ env, request }) => {
  const [, bl] = await guarda(env, request); if (bl) return bl;
  let b; try { b = await request.json(); } catch { return erro("Dados inválidos."); }
  const p = await buscarPedido(env, b.id);
  if (!p) return erro("Pedido não encontrado.", 404);
  try { const r = await etiqueta(env, request, p, b); return json({ ok: true, etiqueta_url: r.etiqueta_url, pedido: { ...publico(r.pedido), cpf: r.pedido.cpf || "", envio_completo: r.pedido.envio || null } }); }
  catch (e) { return erro(e.message || "Erro ao gerar a etiqueta.", 400); }
};
