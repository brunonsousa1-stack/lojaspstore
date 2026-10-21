import { json, pronto, lerEstoque } from "../../server/loja.js";
export const onRequestGet = async ({ env }) => {
  if (!pronto(env)) return json({ estoque: {} });
  return new Response(JSON.stringify({ estoque: await lerEstoque(env) }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=20" } });
};
