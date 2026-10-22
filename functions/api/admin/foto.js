// Painel › Produtos: recebe uma foto já convertida para WebP no navegador e guarda no Supabase Storage.
import { json, erro, enviarFoto } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";

const MAX = 3 * 1024 * 1024;
const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "foto";

export const onRequestPost = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  let d; try { d = await request.json(); } catch { return erro("Dados inválidos."); }
  const b64 = String(d.base64 || "").replace(/^data:image\/webp;base64,/, "").replace(/\s/g, "");
  if (!b64) return erro("Foto vazia.");
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return erro("Foto inválida."); }
  if (bytes.length > MAX) return erro("Foto grande demais (máx. 3 MB depois de convertida).");
  const tag = String.fromCharCode(...bytes.slice(0, 4)) + String.fromCharCode(...bytes.slice(8, 12));
  if (tag !== "RIFFWEBP") return erro("Formato de foto inválido.");
  const nome = `produtos/${slug(d.nome)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.webp`;
  try { return json({ ok: true, url: await enviarFoto(env, nome, bytes) }); }
  catch (e) { return erro("Não consegui enviar a foto: " + String(e.message || e).slice(0, 140), 502); }
};
