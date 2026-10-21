import { opcoesFrete, erro } from "../../server/loja.js";
export const onRequestPost = async ({ env, request }) => {
  try { return await opcoesFrete(env, request); } catch (e) { return erro("Não foi possível calcular o frete agora.", 500); }
};
