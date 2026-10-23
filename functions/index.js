// Página inicial: a mesma index.html, mas com o banner do topo já no HTML (carrega mais rápido e não "pula").
import { aplicarBanner, lerLoja } from "../server/banner.js";
import { embutirDados } from "../server/dados.js";

export const onRequestGet = async ({ env, request, next }) => {
  const res = await next();
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  try {
    const origem = new URL(request.url).origin;
    const [html, loja] = await Promise.all([res.text(), lerLoja(origem, env)]);
    const h = new Headers(res.headers); h.delete("content-length"); h.set("cache-control", "public, max-age=120");
    return new Response(await embutirDados(await aplicarBanner(html, loja, "", origem, env), request, env), { status: 200, headers: h });
  } catch { return res; }
};
