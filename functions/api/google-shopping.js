// Lista de produtos para o Google Merchant Center (Google Shopping grátis).
// Endereço para cadastrar no Merchant Center: https://lojaspstore.com.br/api/google-shopping
// Um item por cor; atualiza sozinho com o painel › Produtos e com o estoque.
import { catalogo, lerEstoque, chaveEstoque, pronto } from "../../server/loja.js";
import { slug, xml, abs, fotosDe, preco2, CAT_GOOGLE, descricao, titulo } from "../../server/seo.js";

export const onRequestGet = async ({ env, request }) => {
  const origem = new URL(request.url).origin;
  const { produtos, loja } = await catalogo(request, env);
  const est = pronto(env) ? await lerEstoque(env).catch(() => ({})) : {};
  const itens = [];

  for (const p of produtos) {
    if (p.ativo === false || !(Number(p.preco) > 0)) continue;
    const vs = p.variantes && p.variantes.length ? p.variantes : [{ nome: "Padrão" }];
    for (const v of vs) {
      const fotos = fotosDe(v).map(f => abs(origem, f));
      if (!fotos.length) continue; // o Google exige foto
      const q = est[chaveEstoque(p.nome, v.nome)];
      const cor = v.nome !== "Padrão" ? v.nome : "";
      const link = `${origem}/p/${slug(p.nome)}${cor ? "?cor=" + slug(v.nome) : ""}`;
      const promo = Number(p.preco_de) > Number(p.preco);
      const genero = /feminin/i.test(p.nome) ? "female" : /masculin/i.test(p.nome) ? "male" : "unisex";
      itens.push(`<item>
<g:id>${xml(v.sku || `${slug(p.nome)}-${slug(v.nome)}`.slice(0, 50))}</g:id>
<g:item_group_id>${xml(slug(p.nome).slice(0, 50))}</g:item_group_id>
<title>${xml(titulo(p, cor).slice(0, 150))}</title>
<description>${xml(descricao(p, loja).slice(0, 5000))}</description>
<link>${xml(link)}</link>
<g:image_link>${xml(fotos[0])}</g:image_link>
${fotos.slice(1, 11).map(f => `<g:additional_image_link>${xml(f)}</g:additional_image_link>`).join("\n")}
<g:availability>${typeof q === "number" && q <= 0 ? "out_of_stock" : "in_stock"}</g:availability>
<g:price>${preco2(promo ? p.preco_de : p.preco)} BRL</g:price>
${promo ? `<g:sale_price>${preco2(p.preco)} BRL</g:sale_price>` : ""}
<g:condition>new</g:condition>
<g:brand>SP Store</g:brand>
<g:identifier_exists>no</g:identifier_exists>
<g:google_product_category>${CAT_GOOGLE[p.categoria] || "167"}</g:google_product_category>
<g:product_type>${xml(p.categoria === "relogios" ? "Relógios" : "Óculos de sol")}</g:product_type>
${cor ? `<g:color>${xml(cor.slice(0, 100))}</g:color>` : ""}
<g:gender>${genero}</g:gender>
<g:age_group>adult</g:age_group>
${v.sku ? `<g:mpn>${xml(v.sku)}</g:mpn>` : ""}
</item>`);
    }
  }

  const corpo = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>SP Store</title>
<link>${origem}/</link>
<description>Óculos de sol e relógios · SP Store</description>
${itens.join("\n")}
</channel>
</rss>
`;
  return new Response(corpo.replace(/\n{2,}/g, "\n"), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
};
