// Painel › Produtos: lê e salva o catálogo no banco (Supabase, config "catalogo") e o estoque por cor.
// O site passa a usar o catálogo do banco assim que ele é salvo pela primeira vez (atualiza na hora).
import { json, erro, lerEstoque, salvarEstoque, catalogo, catalogoDb, salvarCatalogoDb, urlFotosBase } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";

const CATEGORIAS = ["oculos", "relogios"];
const DESENHOS = ["hex", "avi", "round", "drop", "digital"];

const txt = (t, max) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const num = (n, min, max) => { const v = Number(n); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null; };
const corHex = c => (typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : undefined);

function limpaProduto(p, i, baseFotos) {
  const foto = f => {
    if (typeof f !== "string" || f.length > 400 || /["<>\\\s]/.test(f)) return null;
    if (/^\/img\/[^?#]+$/.test(f) && !f.includes("..")) return f;
    if (f.startsWith(baseFotos) && /^[a-z0-9/_.-]+$/i.test(f.slice(baseFotos.length))) return f;
    return null;
  };
  const nome = txt(p.nome, 120);
  if (!nome) throw new Error(`O produto nº ${i + 1} está sem nome.`);
  const preco = num(p.preco, 0, 100000);
  if (!preco) throw new Error(`Informe o preço de "${nome}".`);
  const out = { nome, categoria: CATEGORIAS.includes(p.categoria) ? p.categoria : "oculos", preco: Math.round(preco * 100) / 100 };
  const de = num(p.preco_de, 0, 100000);
  if (de && de > out.preco) out.preco_de = Math.round(de * 100) / 100;
  out.descricao = txt(p.descricao, 2000);
  out.selos = (Array.isArray(p.selos) ? p.selos : []).map(s => txt(s, 30)).filter(Boolean).slice(0, 4);
  out.ativo = p.ativo !== false;

  const vs = (Array.isArray(p.variantes) ? p.variantes : []).slice(0, 30);
  if (!vs.length) throw new Error(`"${nome}" precisa de pelo menos uma cor.`);
  const nomesCor = new Set();
  out.variantes = vs.map((v, k) => {
    const cor = txt(v.nome, 60) || (vs.length === 1 ? "Padrão" : "");
    if (!cor) throw new Error(`Dê um nome para a cor nº ${k + 1} de "${nome}".`);
    if (nomesCor.has(cor.toLowerCase())) throw new Error(`"${nome}" tem duas cores com o nome "${cor}".`);
    nomesCor.add(cor.toLowerCase());
    const fotos = (Array.isArray(v.fotos) ? v.fotos : [v.foto, ...(v.fotos_extras || [])]).map(foto).filter(Boolean).slice(0, 15);
    const o = { nome: cor, foto: fotos[0] || "", fotos_extras: fotos.slice(1) };
    const a = {};
    const cp = corHex(v.avancado && v.avancado.cor_principal), cd = corHex(v.avancado && v.avancado.cor_detalhe);
    if (cp) a.cor_principal = cp;
    if (cd) a.cor_detalhe = cd;
    if (Object.keys(a).length) o.avancado = a;
    return o;
  });

  const av = p.avancado || {};
  const a = {};
  if (DESENHOS.includes(av.desenho)) a.desenho = av.desenho;
  for (const [k, mx] of [["peso_g", 30000], ["largura_cm", 100], ["altura_cm", 100], ["comprimento_cm", 100]]) {
    const v = num(av[k], 0, mx);
    if (v) a[k] = k === "peso_g" ? Math.round(v) : Math.round(v * 10) / 10;
  }
  if (Object.keys(a).length) out.avancado = a;
  return out;
}

export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  try {
    const [cat, db, estoque] = await Promise.all([catalogo(request, env), catalogoDb(env), lerEstoque(env)]);
    return json({ produtos: cat.produtos, versao: (db && db.atualizado_em) || "", fonte: cat.fonte, estoque });
  } catch (e) {
    return erro("Não consegui carregar os produtos: " + String(e.message || e).slice(0, 160), 500);
  }
};

export const onRequestPut = async ({ env, request }) => {
  const [u, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }

  let produtos;
  try {
    const lista = Array.isArray(d.produtos) ? d.produtos.slice(0, 300) : null;
    if (!lista) throw new Error("Lista de produtos inválida.");
    const base = urlFotosBase(env);
    produtos = lista.map((p, i) => limpaProduto(p, i, base));
    const nomes = new Set();
    for (const p of produtos) {
      const k = p.nome.toLowerCase();
      if (nomes.has(k)) throw new Error(`Há dois produtos com o nome "${p.nome}". Os nomes precisam ser diferentes.`);
      nomes.add(k);
    }
  } catch (e) {
    return erro(e.message || "Dados inválidos.");
  }

  // Evita apagar a mudança de outra pessoa/aba: confere se o catálogo é o mesmo que foi aberto.
  const atual = await catalogoDb(env);
  const versaoAtual = (atual && atual.atualizado_em) || "";
  if (String(d.versao || "") !== versaoAtual) {
    return erro("Os produtos foram alterados em outra aba ou aparelho enquanto você editava. Recarregue a página e faça a mudança de novo.", 409);
  }

  let salvo;
  try { salvo = await salvarCatalogoDb(env, produtos, u.email); }
  catch (e) { return erro("Não consegui salvar os produtos. Tente de novo.", 502); }

  let aviso = "";
  if (Array.isArray(d.estoque) && d.estoque.length) {
    try { await salvarEstoque(env, d.estoque); } catch { aviso = "Os produtos foram salvos, mas o estoque não. Confira na tela Estoque."; }
  }
  return json({ ok: true, produtos: salvo.produtos, versao: salvo.atualizado_em, estoque: await lerEstoque(env), aviso });
};
