// Painel › Produtos: recebe uma foto já convertida para WebP no navegador e guarda no Supabase Storage.
// Junto com cada foto vai uma miniatura (mesmo nome terminado em ".p.webp"), usada na vitrine,
// nas bolinhas de cor, no "Leve também" e no carrinho, para o site abrir mais rápido.
// GET: lista as fotos dos produtos que ainda não têm miniatura (o painel cria as que faltam sozinho).
import { json, erro, enviarFoto, listarFotos, catalogo, urlFotosBase } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";

const MAX = 3 * 1024 * 1024, MAX_MINI = 512 * 1024;
const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "foto";
const ORIGINAL = /^produtos\/[a-z0-9_-]+(\.[a-z0-9_-]+)*\.webp$/i;
const miniDe = caminho => caminho.replace(/\.webp$/i, ".p.webp");

function webp(base64, max) {
  const b64 = String(base64 || "").replace(/^data:image\/webp;base64,/, "").replace(/\s/g, "");
  if (!b64) throw new Error("Foto vazia.");
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { throw new Error("Foto inválida."); }
  if (bytes.length > max) throw new Error(`Foto grande demais (máx. ${Math.round(max / 1048576 * 10) / 10} MB depois de convertida).`);
  const tag = String.fromCharCode(...bytes.slice(0, 4)) + String.fromCharCode(...bytes.slice(8, 12));
  if (tag !== "RIFFWEBP") throw new Error("Formato de foto inválido.");
  return bytes;
}

export const onRequestPost = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  try {
    // só a miniatura de uma foto que já existe (fotos antigas)
    if (d.miniaturaDe) {
      const caminho = String(d.miniaturaDe);
      if (!ORIGINAL.test(caminho) || caminho.includes("..") || /\.p\.webp$/i.test(caminho)) return erro("Foto inválida.");
      const bytes = webp(d.mini, MAX_MINI);
      return json({ ok: true, url: await enviarFoto(env, miniDe(caminho), bytes) });
    }
    const bytes = webp(d.base64, MAX);
    const mini = d.mini ? webp(d.mini, MAX_MINI) : null;
    const nome = `produtos/${slug(d.nome)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.webp`;
    if (mini) await enviarFoto(env, miniDe(nome), mini);
    return json({ ok: true, url: await enviarFoto(env, nome, bytes) });
  } catch (e) {
    const m = String(e.message || e);
    if (!m.startsWith("Fotos:")) return erro(m);
    return erro("Não consegui enviar a foto: " + m.slice(0, 140), 502);
  }
};

export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  try {
    const base = urlFotosBase(env);
    const existem = new Set((await listarFotos(env, "produtos")).map(n => "produtos/" + n));
    const { produtos } = await catalogo(request, env);
    const faltando = new Set();
    for (const p of produtos) for (const v of p.variantes || []) for (const f of [v.foto, ...(v.fotos_extras || [])]) {
      if (typeof f !== "string" || !f.startsWith(base)) continue;
      const c = f.slice(base.length);
      if (ORIGINAL.test(c) && !/\.p\.webp$/i.test(c) && existem.has(c) && !existem.has(miniDe(c))) faltando.add(c);
    }
    return json({ faltando: [...faltando] });
  } catch (e) { return erro("Não consegui conferir as fotos: " + String(e.message || e).slice(0, 140), 502); }
};
