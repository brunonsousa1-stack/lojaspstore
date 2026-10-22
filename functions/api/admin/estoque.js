import { json, erro, listaEstoque, salvarEstoque } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";
export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  try { return json({ produtos: await listaEstoque(env, request) }); } catch (e) { return erro("Erro ao ler o estoque. Confira se a tabela de estoque foi criada no Supabase.", 500); }
};
export const onRequestPost = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  try { await salvarEstoque(env, d.itens); return json({ ok: true, produtos: await listaEstoque(env, request) }); }
  catch (e) { return erro("Não foi possível salvar. Confira se a tabela de estoque foi criada no Supabase.", 500); }
};
