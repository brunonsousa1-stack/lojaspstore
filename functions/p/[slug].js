// Página própria de cada produto: /p/<nome-do-produto>
// Entrega a mesma loja (index.html) já com título, foto, preço e dados estruturados do produto,
// para o Google Shopping e para o link compartilhado no WhatsApp/Instagram mostrar foto e preço.
import { catalogo, lerEstoque, chaveEstoque, pronto } from "../../server/loja.js";
import { resumoPublico } from "../../server/avaliacoes.js";
import { aplicarBanner } from "../../server/banner.js";
import { embutirDados } from "../../server/dados.js";
import { slug, abs, fotosDe, preco2, CAT_NOME, descricao, titulo as tituloDe } from "../../server/seo.js";

const attr = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const onRequestGet = async ({ env, request, params }) => {
  const url = new URL(request.url), origem = url.origin;
  const pagina = await env.ASSETS.fetch(new URL("/index.html", origem));
  let html = await pagina.text();
  let p = null, loja = {}, est = {};
  try {
    const c = await catalogo(request, env);
    loja = c.loja;
    p = c.produtos.find(x => x.ativo !== false && slug(x.nome) === String(params.slug || ""));
    if (p && pronto(env)) est = await lerEstoque(env);
  } catch {}
  if (!p) return Response.redirect(origem + "/#vitrine", 302);
  let nota = null;
  try { if (pronto(env)) { const r = (await resumoPublico(env)).produtos[p.nome]; if (r && r.qtd) nota = r; } } catch {}

  const vs = p.variantes && p.variantes.length ? p.variantes : [{ nome: "Padrão" }];
  const corPedida = url.searchParams.get("cor");
  const vi = Math.max(0, vs.findIndex(v => slug(v.nome) === corPedida));
  const v = vs[vi];
  const foto = abs(origem, fotosDe(v)[0] || vs.map(x => fotosDe(x)[0]).find(Boolean) || "/img/logo.png");
  const titulo = `${tituloDe(p, v.nome)} | SP Store`;
  const desc = descricao(p, loja);
  const canon = `${origem}/p/${slug(p.nome)}`;
  const disp = q => (typeof q === "number" && q <= 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock");

  const ld = {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: p.nome, description: desc, url: canon, productGroupID: slug(p.nome),
    brand: { "@type": "Brand", name: "SP Store" },
    ...(nota ? { aggregateRating: { "@type": "AggregateRating", ratingValue: nota.media, reviewCount: nota.qtd, bestRating: 5, worstRating: 1 },
      review: nota.ultimas.slice(0, 5).map(a => ({ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: a.nota, bestRating: 5 }, author: { "@type": "Person", name: String(a.nome).split(" · ")[0] }, datePublished: String(a.em).slice(0, 10), ...(a.texto ? { reviewBody: a.texto } : {}) })) } : {}),
    category: CAT_NOME[p.categoria] || "",
    variesBy: vs.length > 1 ? ["https://schema.org/color"] : undefined,
    hasVariant: vs.map(x => ({
      "@type": "Product",
      name: tituloDe(p, x.nome),
      sku: x.sku || `${slug(p.nome)}-${slug(x.nome)}`,
      color: x.nome !== "Padrão" ? x.nome : undefined,
      image: fotosDe(x).slice(0, 5).map(f => abs(origem, f)),
      url: `${canon}?cor=${slug(x.nome)}`,
      offers: {
        "@type": "Offer", price: preco2(p.preco), priceCurrency: "BRL", itemCondition: "https://schema.org/NewCondition",
        availability: disp(est[chaveEstoque(p.nome, x.nome)]), url: `${canon}?cor=${slug(x.nome)}`,
        seller: { "@type": "Organization", name: loja.razao_social || "SP Store" },
      },
    })),
  };

  const head = `<base href="/">
<title>${attr(titulo)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${attr(canon)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="SP Store">
<meta property="og:title" content="${attr(titulo)}">
<meta property="og:description" content="${attr(`R$ ${preco2(p.preco).replace(".", ",")} · ${desc}`)}">
<meta property="og:image" content="${attr(foto)}">
<meta property="og:url" content="${attr(canon)}">
<meta property="product:price:amount" content="${preco2(p.preco)}">
<meta property="product:price:currency" content="BRL">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script>if(!location.hash)history.replaceState(null,"",location.pathname+location.search+"#produto-${slug(p.nome)}");</script>`;

  html = html.replace(/<title>[^<]*<\/title>/, "").replace(/<meta name="description"[^>]*>/, "").replace(/<meta property="og:[^>]*>/g, "");
  html = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n${head}`);
  html = await embutirDados(await aplicarBanner(html, loja, "", origem, env), request, env);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
};
