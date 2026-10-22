// Painel › Produtos: lê e salva o catálogo no banco (Supabase, config "catalogo") e o estoque por cor.
// O site passa a usar o catálogo do banco assim que ele é salvo pela primeira vez (atualiza na hora).
import { json, erro, lerEstoque, salvarEstoque, catalogo, catalogoDb, gravarCatalogoSe, urlFotosBase } from "../../../server/loja.js";
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
    const sku = txt(v.sku, 40).replace(/\s+/g, "-").toUpperCase();
    if (sku) o.sku = sku;
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

class ErroUso extends Error { constructor(m, st = 400) { super(m); this.st = st; } }
const mesmo = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const novaV = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function conferirUnicos(lista) {
  const nomes = new Set(), skus = new Map();
  for (const p of lista) {
    const k = p.nome.toLowerCase();
    if (nomes.has(k)) throw new ErroUso(`Já existe outro produto com o nome "${p.nome}". Os nomes precisam ser diferentes.`);
    nomes.add(k);
    for (const v of p.variantes || []) if (v.sku) {
      const ks = v.sku.toLowerCase();
      if (skus.has(ks)) throw new ErroUso(`O SKU "${v.sku}" já é usado em ${skus.get(ks)}. Cada cor precisa de um SKU diferente.`);
      skus.set(ks, `${p.nome} - ${v.nome}`);
    }
  }
}

// Aplica UMA alteração sobre o catálogo mais recente. Só dá conflito se a mesma peça foi mudada por outra pessoa.
function aplicar(lista, d, base) {
  lista = lista.map(p => ({ ...p }));
  const achar = nome => lista.findIndex(p => mesmo(p.nome, nome));
  switch (d.op) {
    case "salvar": {
      const novo = limpaProduto(d.produto || {}, 0, base);
      let i = -1;
      if (d.original) {
        i = achar(d.original);
        if (i < 0) throw new ErroUso(`"${d.original}" foi excluído ou renomeado em outra aba ou aparelho. Recarregue a página.`, 409);
        if (d.v && lista[i]._v && lista[i]._v !== d.v) throw new ErroUso(`"${d.original}" foi alterado por outra pessoa enquanto você editava. Recarregue para ver a versão nova e faça a mudança de novo.`, 409);
      }
      novo._v = novaV();
      if (i >= 0) lista[i] = novo; else lista.unshift(novo);
      break;
    }
    case "ativo": {
      const i = achar(d.nome); if (i < 0) throw new ErroUso("Produto não encontrado. Recarregue a página.", 409);
      lista[i] = { ...lista[i], ativo: !!d.ativo, _v: novaV() };
      break;
    }
    case "mover": {
      const i = achar(d.nome); if (i < 0) throw new ErroUso("Produto não encontrado. Recarregue a página.", 409);
      const j = d.para === "antes" ? i - 1 : i + 1;
      if (j >= 0 && j < lista.length) [lista[i], lista[j]] = [lista[j], lista[i]];
      break;
    }
    case "excluir": {
      const i = achar(d.nome); if (i < 0) return lista; // já excluído
      lista.splice(i, 1);
      break;
    }
    default: throw new ErroUso("Ação inválida.");
  }
  conferirUnicos(lista);
  return lista;
}

export const onRequestPut = async ({ env, request }) => {
  const [u, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  const base = urlFotosBase(env);

  // tela antiga (já aberta antes desta atualização): manda a lista inteira + "novo/edita <nome>"
  if (!d.op && Array.isArray(d.produtos)) {
    const m = String(d.resumo || "").match(/^(novo|edita) (.+)$/);
    if (!m) return erro("Esta tela está desatualizada. Recarregue a página (F5) e faça a mudança de novo.", 409);
    const prod = d.produtos.find(p => mesmo(p && p.nome, m[2]));
    if (!prod) return erro("Dados inválidos.");
    d = { op: "salvar", produto: prod, original: m[1] === "edita" ? m[2] : null, estoque: d.estoque };
  }

  let salvo = null;
  try {
    for (let t = 0; t < 4 && !salvo; t++) {
      const [cat, db] = await Promise.all([catalogo(request, env), catalogoDb(env)]);
      const lista = aplicar(cat.produtos || [], d, base);
      salvo = await gravarCatalogoSe(env, db && db.atualizado_em, lista, u.email);
    }
  } catch (e) {
    if (e instanceof ErroUso) return erro(e.message, e.st);
    return erro("Não consegui salvar os produtos. Tente de novo.", 502);
  }
  if (!salvo) return erro("Muitas alterações ao mesmo tempo. Tente salvar de novo.", 503);

  let aviso = "";
  if (Array.isArray(d.estoque) && d.estoque.length) {
    try { await salvarEstoque(env, d.estoque); } catch { aviso = "Os produtos foram salvos, mas o estoque não. Confira na tela Estoque."; }
  }
  return json({ ok: true, produtos: salvo.produtos, versao: salvo.atualizado_em, estoque: await lerEstoque(env), aviso });
};
