// Painel › Avaliações: lista e aprova/recusa/exclui.
import { json, erro } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";
import { listaAdmin, moderar } from "../../../server/avaliacoes.js";

export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  try { return json({ avaliacoes: await listaAdmin(env) }); } catch { return erro("Não consegui carregar as avaliações.", 500); }
};
export const onRequestPost = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  try { await moderar(env, String(d.id || ""), String(d.status || "")); return json({ ok: true, avaliacoes: await listaAdmin(env) }); }
  catch (e) { return erro(e.message || "Erro ao salvar.", 400); }
};
