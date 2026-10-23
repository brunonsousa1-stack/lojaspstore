// Fotos dos produtos (Supabase Storage) servidas pelo próprio site com cache longo:
// o celular guarda a foto e não baixa de novo a cada visita. Os nomes das fotos são únicos,
// então uma foto nova sempre tem endereço novo.
import { urlFotosBase } from "../../server/loja.js";

export const onRequestGet = async ({ env, params, request }) => {
  const partes = [].concat(params.caminho || []);
  const caminho = partes.join("/");
  if (!caminho || !/^[a-z0-9/_.-]+$/i.test(caminho) || caminho.includes("..")) return new Response("Não encontrado", { status: 404 });
  const cache = caches.default, chave = new Request(new URL(request.url).origin + "/f/" + caminho);
  let r = await cache.match(chave);
  if (r) return r;
  const orig = await fetch(urlFotosBase(env) + caminho, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
  if (!orig.ok) return new Response("Não encontrado", { status: orig.status === 400 ? 404 : orig.status, headers: { "cache-control": "no-store" } });
  const h = new Headers();
  h.set("content-type", orig.headers.get("content-type") || "image/webp");
  h.set("cache-control", "public, max-age=31536000, immutable");
  h.set("access-control-allow-origin", "*");
  r = new Response(orig.body, { status: 200, headers: h });
  try { await cache.put(chave, r.clone()); } catch {}
  return r;
};
