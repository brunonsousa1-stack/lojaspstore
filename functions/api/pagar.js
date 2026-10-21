import { pagar, erro } from "../../server/loja.js";
export const onRequestPost = async ({ env, request }) => {
  try { return await pagar(env, request); } catch (e) { return erro("Erro ao processar o pagamento. Tente de novo.", 500); }
};
