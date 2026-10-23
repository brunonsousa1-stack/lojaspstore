// Catálogo público do site: produtos do banco (painel › Produtos) ou, se ainda não houver, do arquivo data/produtos.json.
import { catalogo, urlFotosBase } from "../../server/loja.js";

// fotos do Supabase passam pelo próprio site (/f/...), que entrega com cache longo
function fotosLocais(produtos, env) {
  let base = ""; try { base = urlFotosBase(env); } catch {}
  if (!base || base.startsWith("/storage")) return produtos;
  const troca = f => typeof f === "string" && f.startsWith(base) ? "/f/" + f.slice(base.length) : f;
  return produtos.map(p => ({ ...p, variantes: (p.variantes || []).map(v => ({ ...v, foto: troca(v.foto), ...(Array.isArray(v.fotos_extras) ? { fotos_extras: v.fotos_extras.map(troca) } : {}), ...(Array.isArray(v.fotos) ? { fotos: v.fotos.map(troca) } : {}) })) }));
}

export const onRequestGet = async ({ env, request }) => {
  try {
    const { produtos, fonte } = await catalogo(request, env);
    return new Response(JSON.stringify({ produtos: fotosLocais(produtos, env), fonte }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ erro: "indisponível" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};
