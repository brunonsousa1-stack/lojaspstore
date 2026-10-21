import { pixDireto, erro } from "../../server/loja.js";
export const onRequestPost = async ({ env, request }) => {
  try { return await pixDireto(env, request); } catch (e) { return erro("Não foi possível gerar o Pix agora. Tente de novo.", 500); }
};
