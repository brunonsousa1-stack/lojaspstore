import { webhook, json } from "../../server/loja.js";
// O Mercado Pago repete a notificação se a resposta não for 200; em erro devolvemos 500 para ele tentar de novo.
export const onRequestPost = async ({ env, request }) => {
  try { return await webhook(env, request); } catch (e) { return json({ erro: String(e.message || e) }, 500); }
};
export const onRequestGet = () => json({ ok: true });
