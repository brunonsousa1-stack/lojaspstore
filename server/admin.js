import { erro, usuario, ehAdmin, pronto } from "./loja.js";
export async function guarda(env, request) {
  if (!pronto(env)) return [null, erro("Loja não configurada.", 503)];
  const u = await usuario(env, request);
  if (!u) return [null, erro("Entre com o e-mail da loja.", 401)];
  if (!ehAdmin(env, u)) return [null, erro("Esta conta não tem acesso ao painel de pedidos.", 403)];
  return [u, null];
}
