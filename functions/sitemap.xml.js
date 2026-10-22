// Mapa do site para o Google: página inicial, trocas e uma página por produto.
import { catalogo } from "../server/loja.js";
import { slug, xml } from "../server/seo.js";

export const onRequestGet = async ({ env, request }) => {
  const origem = new URL(request.url).origin;
  const { produtos } = await catalogo(request, env);
  const urls = ["/", "/trocas.html", ...produtos.filter(p => p.ativo !== false).map(p => "/p/" + slug(p.nome))];
  const corpo = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${xml(origem + u)}</loc></url>`).join("\n")}
</urlset>
`;
  return new Response(corpo, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
};
