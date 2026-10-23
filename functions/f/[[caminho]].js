// Fotos dos produtos (Supabase Storage) servidas pelo próprio site com cache longo:
// o celular guarda a foto e não baixa de novo a cada visita. Os nomes das fotos são únicos,
// então uma foto nova sempre tem endereço novo.
// Miniaturas ("....p.webp"): se ainda não existir, entrega a foto original com cache curto,
// e assim que o painel criar a miniatura o site passa a usá-la.
import { urlFotosBase } from "../../server/loja.js";

const buscar = (env, caminho) => fetch(urlFotosBase(env) + caminho, {
  cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 31536000, "300-599": 0 } },
});

export const onRequestGet = async ({ env, params, request }) => {
  const partes = [].concat(params.caminho || []);
  const caminho = partes.join("/");
  if (!caminho || !/^[a-z0-9/_.-]+$/i.test(caminho) || caminho.includes("..")) return new Response("Não encontrado", { status: 404 });
  const cache = caches.default, chave = new Request(new URL(request.url).origin + "/f/" + caminho);
  let r = await cache.match(chave);
  if (r) return r;
  let orig = await buscar(env, caminho), provisoria = false;
  if (!orig.ok && /\.p\.webp$/i.test(caminho)) {
    orig = await buscar(env, caminho.replace(/\.p\.webp$/i, ".webp"));
    provisoria = true;
  }
  if (!orig.ok) return new Response("Não encontrado", { status: orig.status === 400 ? 404 : orig.status, headers: { "cache-control": "no-store" } });
  const h = new Headers();
  h.set("content-type", orig.headers.get("content-type") || "image/webp");
  h.set("cache-control", provisoria ? "public, max-age=600" : "public, max-age=31536000, immutable");
  h.set("access-control-allow-origin", "*");
  r = new Response(orig.body, { status: 200, headers: h });
  if (!provisoria) { try { await cache.put(chave, r.clone()); } catch {} }
  return r;
};
