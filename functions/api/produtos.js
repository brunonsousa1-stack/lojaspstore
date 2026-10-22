// Catálogo público do site: produtos do banco (painel › Produtos) ou, se ainda não houver, do arquivo data/produtos.json.
import { catalogo } from "../../server/loja.js";

export const onRequestGet = async ({ env, request }) => {
  try {
    const { produtos, fonte } = await catalogo(request, env);
    return new Response(JSON.stringify({ produtos, fonte }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ erro: "indisponível" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};
