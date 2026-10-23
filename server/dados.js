// Produtos, textos da loja e notas das avaliações já dentro do HTML (página inicial, categorias e produto).
// Assim a vitrine aparece pronta no primeiro desenho da página, sem trocar o conteúdo depois
// (era isso que fazia a página "pular" no PageSpeed). O navegador ainda busca tudo de novo em seguida
// para pegar qualquer mudança dos últimos minutos.
import { catalogo, urlFotosBase, pronto } from "./loja.js";
import { resumoPublico } from "./avaliacoes.js";

function fotosLocais(produtos, env) {
  let base = ""; try { base = urlFotosBase(env); } catch {}
  if (!base || base.startsWith("/storage")) return produtos;
  const troca = f => typeof f === "string" && f.startsWith(base) ? "/f/" + f.slice(base.length) : f;
  return produtos.map(p => ({ ...p, variantes: (p.variantes || []).map(v => ({ ...v, foto: troca(v.foto), ...(Array.isArray(v.fotos_extras) ? { fotos_extras: v.fotos_extras.map(troca) } : {}) })) }));
}

export async function embutirDados(html, request, env) {
  try {
    if (!html.includes("</head>") || html.includes("window.__DADOS=")) return html;
    const [c, av] = await Promise.all([
      catalogo(request, env),
      pronto(env) ? resumoPublico(env).catch(() => null) : Promise.resolve(null),
    ]);
    const dados = { produtos: fotosLocais(c.produtos || [], env), loja: c.loja || {}, av };
    const js = JSON.stringify(dados).replace(/</g, "\\u003c").split(String.fromCharCode(8232)).join("\\u2028").split(String.fromCharCode(8233)).join("\\u2029");
    return html.replace("</head>", () => `<script>window.__DADOS=${js}</script>\n</head>`);
  } catch { return html; }
}
