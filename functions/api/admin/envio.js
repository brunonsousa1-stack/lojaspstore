import { json, erro, infoEnvio, salvarRemetente } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";
export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  try { return json(await infoEnvio(env)); } catch (e) { return erro("Erro ao ler as configurações.", 500); }
};
export const onRequestPost = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  try { return json({ ok: true, remetente: await salvarRemetente(env, d) }); } catch (e) { return erro(e.message, 400); }
};
