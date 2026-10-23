// SP Store · páginas de produto para Google/WhatsApp e lista de produtos do Google Shopping
export const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const xml = t => String(t ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
export const abs = (origem, u) => (!u ? "" : /^https?:\/\//.test(u) ? u : origem + (u.startsWith("/") ? u : "/" + u));
export const fotosDe = v => [v.foto, ...((v && v.fotos_extras) || [])].filter(Boolean);
export const preco2 = n => Number(n).toFixed(2);

// Categoria do Google (taxonomia oficial): óculos de sol = 178, relógios = 201
export const CAT_GOOGLE = { oculos: "178", relogios: "201" };
export const CAT_NOME = { oculos: "Óculos de sol", relogios: "Relógio" };

// texto sem a formatação do site (**negrito**, ✔), para Google Shopping, catálogo do Instagram e prévias de link
export const textoLimpo = t => String(t || "").replace(/\*\*/g, "").replace(/[✔✓]\uFE0F?\s*/g, "• ")
  .split("\n").map(l => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();

export function descricao(p, loja) {
  const base = textoLimpo(p.descricao);
  const extra = p.categoria === "oculos" ? "Óculos de sol com proteção UV400." : "Relógio com máquina quartz.";
  const promo = Number(loja.promo_leve) >= 2 && ((loja.promo_categoria || "oculos") === "todos" || p.categoria === (loja.promo_categoria || "oculos")) ? ` Compre ${loja.promo_leve}, pague ${loja.promo_leve - 1}.` : "";
  const jaTemPromo = /pague\s*\d/i.test(base);
  return (base || `${p.nome}. ${extra}`) + (jaTemPromo ? "" : promo) + (base ? "\n\n" : " ") + "Envio para todo o Brasil pela SP Store.";
}

// "Óculos Hexagonal Marrom" + cor "Marrom" -> não repete a cor no título
export const titulo = (p, cor) => (!cor || cor === "Padrão" || slug(p.nome).includes(slug(cor)) ? p.nome : `${p.nome} - ${cor}`);
