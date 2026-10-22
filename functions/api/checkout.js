import { checkout, erro } from "../../server/loja.js";
export const onRequestPost = async ({ env, request }) => {
  try { return await checkout(env, request); } catch (e) { return erro("Erro ao registrar o pedido. Tente de novo.", 500); }
};
