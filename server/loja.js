// =============== SP Store · motor da loja (Cloudflare Pages Functions) ===============
// Variáveis no Cloudflare (Workers & Pages > lojaspstore > Settings > Variables and Secrets):
//   SUPABASE_URL          https://xxxx.supabase.co
//   SUPABASE_ANON_KEY     chave pública (anon / publishable)
//   SUPABASE_SERVICE_KEY  chave secreta (service_role / secret)       [Secret]
//   MP_PUBLIC_KEY         Public Key de produção do Mercado Pago (pública)
//   MP_ACCESS_TOKEN       Access Token de produção do Mercado Pago      [Secret]
//   RESEND_API_KEY        chave da Resend para os e-mails               [Secret]
//   LOJA_EMAIL            e-mail do dono: entra no painel de pedidos e recebe aviso de venda
//   EMAIL_REMETENTE       opcional. Padrão: SP Store <pedidos@lojaspstore.com.br>
//   MP_WEBHOOK_SECRET     opcional. Assinatura secreta das notificações do Mercado Pago

import { cotar, meAtivo, gerarEtiqueta, validarRemetente, saldo } from "./frete.js";
import { brCode, pixAtivo } from "./pix.js";
import { distanciaBase } from "./geo.js";

export const STATUS = {
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pagamento aprovado",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
const ORDEM = ["aguardando_pagamento", "pago", "enviado", "entregue"];

const cfg = env => ({
  sbUrl: String(env.SUPABASE_URL || "").replace(/\/+$/, ""),
  sbAnon: String(env.SUPABASE_ANON_KEY || ""),
  sbService: String(env.SUPABASE_SERVICE_KEY || ""),
  mpToken: String(env.MP_ACCESS_TOKEN || ""),
  mpPublic: String(env.MP_PUBLIC_KEY || ""),
  mpApi: String(env.MP_API || "https://api.mercadopago.com").replace(/\/+$/, ""),
  resendKey: String(env.RESEND_API_KEY || ""),
  resendApi: String(env.RESEND_API || "https://api.resend.com").replace(/\/+$/, ""),
  lojaEmail: String(env.LOJA_EMAIL || "").trim().toLowerCase(),
  remetente: String(env.EMAIL_REMETENTE || "SP Store <pedidos@lojaspstore.com.br>"),
  responder: String(env.EMAIL_RESPOSTA || "atendimento@lojaspstore.com.br").trim(),
  webhookSecret: String(env.MP_WEBHOOK_SECRET || ""),
});
// contas e pedidos funcionam com o banco; o pagamento pode ser cartão (Mercado Pago) e/ou Pix direto na chave da loja
export const pronto = env => { const c = cfg(env); return !!(c.sbUrl && c.sbAnon && c.sbService); };
export const cartaoPronto = env => { const c = cfg(env); return !!(c.mpToken && c.mpPublic); };
export async function configPublica(env, request) {
  const c = cfg(env); let loja = {};
  try { loja = (await catalogo(request, env)).loja; } catch {}
  const pix = pixAtivo(loja), cartao = cartaoPronto(env);
  return { pronto: pronto(env) && (pix || cartao), pix, cartao, supabaseUrl: c.sbUrl, supabaseAnonKey: c.sbAnon, mpPublicKey: cartao ? c.mpPublic : "" };
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export const erro = (msg, status = 400) => json({ erro: msg }, status);

const reais = n => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");
const cents = n => Math.round(Number(n) * 100);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const so = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const digitos = t => String(t ?? "").replace(/\D/g, "");

// ---------- Supabase ----------
function sbHeaders(key, extra = {}) {
  const h = { apikey: key, "content-type": "application/json", ...extra };
  if (key.startsWith("eyJ")) h.authorization = "Bearer " + key; // chave antiga (JWT)
  return h;
}
async function sb(env, caminho, opcoes = {}) {
  const c = cfg(env);
  const r = await fetch(`${c.sbUrl}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: sbHeaders(c.sbService, { prefer: "return=representation", ...(opcoes.headers || {}) }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Banco: ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
export async function usuario(env, request) {
  const tok = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok) return null;
  const c = cfg(env);
  const r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.sbAnon, authorization: "Bearer " + tok } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
export const ehAdmin = (env, u) => {
  const c = cfg(env);
  return !!(u && c.lojaEmail && String(u.email || "").toLowerCase() === c.lojaEmail && u.email_confirmed_at);
};

export async function buscarPedido(env, id) {
  if (!/^\d{1,12}$/.test(String(id))) return null;
  const r = await sb(env, `pedidos?id=eq.${id}&select=*`, { method: "GET" });
  return r && r[0] ? r[0] : null;
}
export function publico(p) {
  return {
    id: p.id, criado_em: p.criado_em, status: p.status, status_texto: STATUS[p.status] || p.status,
    nome: p.nome, email: p.email, telefone: p.telefone, endereco: p.endereco, itens: p.itens,
    subtotal: Number(p.subtotal), frete: Number(p.frete), total: Number(p.total), desconto: Math.max(0, Math.round((Number(p.subtotal) + Number(p.frete) - Number(p.total)) * 100) / 100),
    forma_pagamento: p.forma_pagamento, rastreio: p.rastreio || "", historico: p.historico || [], token: p.token,
    envio: p.envio ? { id: p.envio.id, nome: p.envio.nome, empresa: p.envio.empresa, prazo: p.envio.prazo, prazo_txt: p.envio.prazo_txt || "", entrega_em: p.envio.entrega_em || "" } : null,
    pix_informado: !!(p.emails && p.emails.pix_informado),
  };
}
async function mudarStatus(env, p, novo, extra = {}) {
  const hist = Array.isArray(p.historico) ? p.historico.slice() : [];
  if (novo !== p.status) hist.push({ status: novo, em: new Date().toISOString() });
  const r = await sb(env, `pedidos?id=eq.${p.id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...extra, status: novo, historico: hist, atualizado_em: new Date().toISOString() }),
  });
  return r && r[0] ? r[0] : { ...p, ...extra, status: novo, historico: hist };
}

// ---------- catálogo e preços (sempre do servidor, nunca do navegador) ----------
// Produtos: ficam no banco (config "catalogo") depois do primeiro "Salvar" no painel › Produtos.
// Antes disso, ou se o banco falhar, usa o arquivo data/produtos.json do site.
export async function catalogoDb(env) {
  if (!env || !pronto(env)) return null;
  try {
    const r = await sb(env, "config?chave=eq.catalogo&select=valor", { method: "GET" });
    const v = r && r[0] && r[0].valor;
    return v && Array.isArray(v.produtos) ? v : null;
  } catch { return null; }
}
export async function salvarCatalogoDb(env, produtos, por) {
  const valor = { produtos, atualizado_em: new Date().toISOString(), por: por || "" };
  await sb(env, "config?on_conflict=chave", { method: "POST", body: JSON.stringify({ chave: "catalogo", valor }), headers: { prefer: "resolution=merge-duplicates,return=minimal" } });
  return valor;
}
// Grava o catálogo só se ele ainda estiver na versão lida (evita perder a mudança de outra pessoa
// que salvou no mesmo instante). Devolve o valor salvo, ou null se a versão mudou (o chamador tenta de novo).
export async function gravarCatalogoSe(env, versaoLida, produtos, por) {
  const valor = { produtos, atualizado_em: new Date().toISOString() + "-" + Math.random().toString(36).slice(2, 6), por: por || "" };
  if (versaoLida) {
    const r = await sb(env, `config?chave=eq.catalogo&valor->>atualizado_em=eq.${encodeURIComponent(versaoLida)}`, { method: "PATCH", body: JSON.stringify({ valor }) });
    return r && r.length ? valor : null;
  }
  try { await sb(env, "config", { method: "POST", body: JSON.stringify({ chave: "catalogo", valor }), headers: { prefer: "return=minimal" } }); return valor; }
  catch (e) { if (/409|23505|duplicate/i.test(String(e.message))) return null; throw e; }
}
export async function catalogo(request, env) {
  const base = new URL(request.url).origin;
  const [db, d, L] = await Promise.all([
    catalogoDb(env),
    fetch(base + "/data/produtos.json", { cf: { cacheTtl: 0 } }).then(r => r.json()).catch(() => null),
    fetch(base + "/data/loja.json", { cf: { cacheTtl: 0 } }).then(r => r.json()),
  ]);
  return { produtos: (db && db.produtos) || (d && d.produtos) || [], loja: L || {}, fonte: db ? "banco" : "arquivo" };
}

// ---------- fotos no Supabase Storage (bucket público "loja") ----------
const BUCKET = "loja";
function stHeaders(c, extra = {}) {
  const h = { apikey: c.sbService, ...extra };
  if (c.sbService.startsWith("eyJ")) h.authorization = "Bearer " + c.sbService;
  return h;
}
export async function enviarFoto(env, nome, bytes) {
  const c = cfg(env);
  const up = () => fetch(`${c.sbUrl}/storage/v1/object/${BUCKET}/${nome}`, {
    method: "POST", body: bytes,
    headers: stHeaders(c, { "content-type": "image/webp", "cache-control": "31536000", "x-upsert": "true" }),
  });
  let r = await up();
  if (r.status === 404 || r.status === 400) {
    const t = await r.text();
    if (/bucket/i.test(t)) {
      // primeira foto: cria o bucket público
      await fetch(`${c.sbUrl}/storage/v1/bucket`, { method: "POST", headers: stHeaders(c, { "content-type": "application/json" }),
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5242880, allowed_mime_types: ["image/webp", "image/jpeg", "image/png"] }) });
      r = await up();
    } else throw new Error("Fotos: " + r.status + " " + t.slice(0, 120));
  }
  if (!r.ok) throw new Error("Fotos: " + r.status + " " + (await r.text()).slice(0, 120));
  return `${c.sbUrl}/storage/v1/object/public/${BUCKET}/${nome}`;
}
export const urlFotosBase = env => `${cfg(env).sbUrl}/storage/v1/object/public/${BUCKET}/`;
// Desconto no Pix (painel › Banner e textos › "Desconto no Pix (%)"). Vale só sobre os produtos, não sobre o frete.
const r2 = n => Math.round(Number(n) * 100) / 100;
export const pctPix = loja => Math.min(30, Math.max(0, Number(loja && loja.desconto_pix) || 0));
export const totalCheio = p => r2(Number(p.subtotal) + Number(p.frete));
export const totalComPix = (p, loja) => r2(totalCheio(p) - r2(Number(p.subtotal) * pctPix(loja) / 100));
export function calcularFrete(loja, subtotal) {
  const valor = Math.max(0, Number(loja.frete_valor) || 0);
  const gratisAcima = Math.max(0, Number(loja.frete_gratis_acima) || 0);
  if (gratisAcima > 0 && subtotal >= gratisAcima) return 0;
  return valor;
}
// Promoção "leve N, pague N-1" (painel › Banner e textos). As unidades grátis vão para os itens mais baratos da categoria.
export function aplicarPromo(itens, produtos, loja) {
  for (const i of itens) delete i.gratis;
  const leve = Math.floor(Number(loja && loja.promo_leve) || 0);
  if (leve < 2) return itens;
  const cat = (loja && loja.promo_categoria) || "oculos";
  const eleg = itens.filter(i => { const p = produtos.find(q => q.nome === i.nome); return p && p.categoria === cat; });
  let livres = Math.floor(eleg.reduce((a, i) => a + i.qtd, 0) / leve);
  for (const i of [...eleg].sort((a, b) => a.preco - b.preco)) { if (!livres) break; const g = Math.min(livres, i.qtd); i.gratis = g; livres -= g; }
  return itens;
}
export const subtotalItens = itens => itens.reduce((a, i) => a + cents(i.preco) * (i.qtd - (i.gratis || 0)), 0) / 100;
export function montarItens(produtos, pedidos) {
  if (!Array.isArray(pedidos) || !pedidos.length) throw new Error("Seu carrinho está vazio.");
  if (pedidos.length > 30) throw new Error("Carrinho com itens demais.");
  const itens = [];
  for (const x of pedidos) {
    const p = produtos.find(q => q.nome === x.nome && q.ativo !== false);
    if (!p) throw new Error(`"${so(x.nome, 60)}" não está mais disponível. Remova do carrinho.`);
    const vs = p.variantes && p.variantes.length ? p.variantes : [{ nome: "Padrão" }];
    const v = vs.find(q => q.nome === x.cor);
    if (!v) throw new Error(`A cor "${so(x.cor, 40)}" de ${p.nome} não está mais disponível.`);
    const qtd = Math.floor(Number(x.qtd));
    if (!(qtd >= 1 && qtd <= 99)) throw new Error("Quantidade inválida.");
    const preco = Number(p.preco);
    if (!(preco > 0)) throw new Error(`${p.nome} está sem preço.`);
    const ja = itens.find(i => i.nome === p.nome && i.cor === v.nome);
    if (ja) ja.qtd = Math.min(99, ja.qtd + qtd);
    else itens.push({ nome: p.nome, cor: v.nome, qtd, preco, foto: v.foto || "", ...(v.sku ? { sku: String(v.sku).slice(0, 40) } : {}) });
  }
  return itens;
}
export function cpfValido(c) {
  c = digitos(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((s * 10) % 11) % 10 !== +c[t]) return false; }
  return true;
}
export function validarEntrega(b, exigirCpf) {
  const e = b.endereco || {};
  const d = {
    nome: so(b.nome, 80), telefone: digitos(b.telefone).slice(0, 13),
    endereco: {
      cep: digitos(e.cep).slice(0, 8), rua: so(e.rua, 120), numero: so(e.numero, 20), complemento: so(e.complemento, 60),
      bairro: so(e.bairro, 80), cidade: so(e.cidade, 80), uf: so(e.uf, 2).toUpperCase(),
    },
  };
  d.cpf = digitos(b.cpf).slice(0, 11);
  if (d.nome.length < 3) throw new Error("Informe o nome completo.");
  if ((exigirCpf || d.cpf) && !cpfValido(d.cpf)) throw new Error("CPF inválido.");
  if (d.telefone.length < 10) throw new Error("Informe um telefone com DDD.");
  const a = d.endereco;
  if (a.cep.length !== 8) throw new Error("CEP inválido.");
  if (!a.rua || !a.numero || !a.bairro || !a.cidade || !/^[A-Z]{2}$/.test(a.uf)) throw new Error("Preencha o endereço completo.");
  return d;
}

// ---------- estoque (tabela "estoque": chave "Produto|Cor" -> qtd; sem linha = sem controle) ----------
export const chaveEstoque = (nome, cor) => `${nome}|${cor}`;
export async function lerEstoque(env) {
  try { const r = await sb(env, "estoque?select=chave,qtd", { method: "GET" }); return Object.fromEntries((r || []).map(x => [x.chave, Number(x.qtd)])); }
  catch { return {}; }
}
export function conferirEstoque(est, itens) {
  for (const i of itens) {
    const n = est[chaveEstoque(i.nome, i.cor)];
    if (typeof n === "number" && i.qtd > n) throw new Error(n <= 0 ? `${i.nome}${i.cor && i.cor !== "Padrão" ? " (" + i.cor + ")" : ""} esgotou. Remova do carrinho.` : `Temos só ${n} ${n === 1 ? "unidade" : "unidades"} de ${i.nome}${i.cor && i.cor !== "Padrão" ? " (" + i.cor + ")" : ""}. Ajuste a quantidade no carrinho.`);
  }
}
// sinal -1 = baixa (venda paga), +1 = devolve (pedido pago cancelado). Marca no pedido para não repetir.
async function moverEstoque(env, p, sinal) {
  const marc = { ...(p.emails || {}) };
  if (sinal < 0 && marc.estoque_baixado) return p;
  if (sinal > 0 && !marc.estoque_baixado) return p;
  try {
    await sb(env, "rpc/mover_estoque", { method: "POST", body: JSON.stringify({ itens: p.itens.map(i => ({ chave: chaveEstoque(i.nome, i.cor), qtd: i.qtd })), sinal }), headers: { prefer: "return=minimal" } });
  } catch { return p; }
  if (sinal < 0) marc.estoque_baixado = new Date().toISOString(); else delete marc.estoque_baixado;
  const r = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ emails: marc }) }).catch(() => null);
  return r && r[0] ? r[0] : { ...p, emails: marc };
}
export async function salvarEstoque(env, itens) {
  if (!Array.isArray(itens)) throw new Error("Dados inválidos.");
  for (const it of itens.slice(0, 500)) {
    const chave = String(it.chave || "").slice(0, 200); if (!chave.includes("|")) continue;
    if (it.qtd === null || it.qtd === "" || it.qtd === undefined) await sb(env, `estoque?chave=eq.${encodeURIComponent(chave)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    else { const q = Math.max(0, Math.min(99999, Math.floor(Number(it.qtd) || 0))); await sb(env, "estoque?on_conflict=chave", { method: "POST", body: JSON.stringify({ chave, qtd: q, atualizado_em: new Date().toISOString() }), headers: { prefer: "resolution=merge-duplicates,return=minimal" } }); }
  }
  return lerEstoque(env);
}
export async function listaEstoque(env, request) {
  const [{ produtos }, est] = await Promise.all([catalogo(request, env), lerEstoque(env)]);
  return produtos.map(p => ({ nome: p.nome, ativo: p.ativo !== false, foto: (p.variantes && p.variantes[0] && p.variantes[0].foto) || "",
    variantes: (p.variantes && p.variantes.length ? p.variantes : [{ nome: "Padrão" }]).map(v => ({ cor: v.nome, foto: v.foto || "", chave: chaveEstoque(p.nome, v.nome), qtd: est[chaveEstoque(p.nome, v.nome)] ?? null })) }));
}

// ---------- Mercado Pago (API de Orders) ----------
// Checkout transparente: o navegador gera o token do cartão com o SDK do Mercado Pago
// (os dados do cartão não passam por aqui) e o servidor cria a order com o valor do pedido.
const MOTIVOS = {
  insufficient_amount: "Cartão sem limite suficiente.",
  card_insufficient_amount: "Cartão sem limite suficiente.",
  amount_limit_exceeded: "Valor acima do limite do cartão.",
  bad_filled_card_data: "Confira os dados do cartão (número, validade e código de segurança).",
  invalid_card_token: "Confira os dados do cartão e tente de novo.",
  required_call_for_authorize: "O banco pediu autorização. Ligue para o banco do cartão e tente de novo.",
  card_disabled: "Cartão bloqueado ou inativo. Fale com o banco.",
  high_risk: "Pagamento recusado por segurança. Tente outro cartão ou o Pix.",
  max_attempts_exceeded: "Muitas tentativas. Use outro cartão ou o Pix.",
  rejected_by_issuer: "O banco recusou o pagamento. Tente outro cartão ou o Pix.",
  invalid_installments: "Número de parcelas não aceito por este cartão.",
  "3ds_challenge_expired": "O tempo da verificação do banco acabou. Tente de novo.",
  processing_error: "Erro ao processar. Tente de novo em instantes.",
};
const FORMAS = { pix: "Pix", bank_transfer: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", ticket: "Boleto", account_money: "Saldo Mercado Pago" };
const reais2 = n => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Resume a order do Mercado Pago num formato simples usado pelo resto da loja
export function resumoOrder(o) {
  const pg = (o && o.transactions && o.transactions.payments && o.transactions.payments[0]) || {};
  const pm = pg.payment_method || {};
  const st = String(o.status || ""), det = String(pg.status_detail || o.status_detail || "");
  let estado = "recusado";
  if (st === "processed" && /accredited|partially_refunded/.test(o.status_detail || det)) estado = "aprovado";
  else if (st === "action_required" && /waiting_(transfer|payment)/.test(o.status_detail || det)) estado = "aguardando";
  else if (st === "processing" || st === "in_review" || st === "created" || (st === "action_required")) estado = "analise";
  else if (st === "refunded" || st === "charged_back") estado = "devolvido";
  return {
    id: String(o.id || ""), ref: String(o.external_reference || ""), estado, status: st, detalhe: det,
    valor: Number(o.total_paid_amount || 0) || (estado === "aprovado" ? Number(pg.paid_amount || pg.amount || o.total_amount || 0) : 0),
    forma: FORMAS[pm.type] || FORMAS[pm.id] || "",
    pix: pm.qr_code ? { qr: pm.qr_code, qr_base64: pm.qr_code_base64 || "", url: pm.ticket_url || "", expira: pg.date_of_expiration || "" } : null,
  };
}

export async function criarPagamento(env, request, p, f, tipoBrick) {
  const c = cfg(env);
  const metodo = so(f.payment_method_id, 40);
  if (!metodo) throw new Error("Escolha a forma de pagamento.");
  const payerIn = f.payer || {};
  const ident = payerIn.identification && payerIn.identification.number
    ? { type: so(payerIn.identification.type || "CPF", 10), number: digitos(payerIn.identification.number).slice(0, 14) }
    : (p.cpf ? { type: "CPF", number: p.cpf } : undefined);
  const [primeiro, ...resto] = p.nome.split(" ");
  const pagamento = { amount: reais2(p.total), payment_method: {} };
  if (metodo === "pix") {
    pagamento.payment_method = { id: "pix", type: "bank_transfer" };
    pagamento.expiration_time = "P1D";
  } else {
    if (!f.token) throw new Error("Dados do cartão incompletos.");
    // A loja aceita só cartão de crédito (débito desligado).
    if (f.payment_type_id === "debit_card" || tipoBrick === "debit_card") throw new Error("A loja não aceita cartão de débito. Use cartão de crédito ou Pix.");
    const tipo = "credit_card";
    pagamento.payment_method = { id: metodo, type: tipo, token: String(f.token).slice(0, 200), installments: Math.min(12, Math.max(1, Math.floor(Number(f.installments) || 1))) };
  }
  const corpo = {
    type: "online", processing_mode: "automatic",
    total_amount: reais2(p.total), external_reference: String(p.id), description: `SP Store - Pedido ${p.id}`,
    payer: { email: String(payerIn.email || p.email).slice(0, 120), first_name: primeiro, last_name: resto.join(" ") || primeiro, ...(ident ? { identification: ident } : {}) },
    transactions: { payments: [pagamento] },
  };
  const r = await fetch(`${c.mpApi}/v1/orders`, {
    method: "POST",
    headers: { accept: "application/json", authorization: "Bearer " + c.mpToken, "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  // cartão recusado pode voltar com erro HTTP mas com a order no corpo
  const o = d && d.id && d.status ? d : (d && d.data && d.data.id && d.data.status ? d.data : null);
  if (o) return o;
  const causa = (d.errors && d.errors[0] && (d.errors[0].message || d.errors[0].code)) || d.message || "";
  throw new Error("Não foi possível processar o pagamento" + (causa ? `: ${causa}` : ". Confira os dados e tente de novo."));
}
export const motivoRecusa = r => MOTIVOS[r.detalhe] || "Pagamento recusado. Confira os dados ou tente o Pix.";

export async function buscarPagamento(env, id) {
  const c = cfg(env);
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(String(id))) return null;
  const r = await fetch(`${c.mpApi}/v1/orders/${encodeURIComponent(id)}`, { headers: { accept: "application/json", authorization: "Bearer " + c.mpToken } });
  // 400/403/404: order inexistente ou de outra conta (ex.: "Simular notificação" com ID fictício). Ignora.
  if (r.status === 404 || r.status === 400 || r.status === 403) return null;
  if (!r.ok) throw new Error("Mercado Pago: " + r.status);
  return r.json();
}
export async function assinaturaValida(env, request, dataId) {
  const segredo = cfg(env).webhookSecret;
  if (!segredo) return true;
  const sig = request.headers.get("x-signature") || "", reqId = request.headers.get("x-request-id") || "";
  const partes = Object.fromEntries(sig.split(",").map(s => s.trim().split("=")).filter(x => x.length === 2));
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${partes.ts};`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(manifesto)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === partes.v1;
}

// Aplica uma order do Mercado Pago ao pedido. Usado pelo webhook, pelo pagamento e pela página do pedido.
// A order sempre é consultada direto no Mercado Pago: ninguém consegue "aprovar" um pedido de fora.
export async function aplicarPagamento(env, request, ordem, nova = false) {
  const r = resumoOrder(ordem);
  const p = await buscarPedido(env, r.ref);
  if (!p) return { ignorado: "pedido não encontrado" };
  if (!nova && p.mp_pagamento && p.mp_pagamento !== r.id && r.estado !== "aprovado") return { ignorado: "order antiga" };
  const base = { mp_pagamento: r.id, mp_status: `${r.status}/${r.detalhe}`, ...(r.forma ? { forma_pagamento: r.forma } : {}) };
  if (r.estado === "aprovado") {
    if (cents(r.valor || 0) + 1 < cents(p.total)) return { ignorado: "valor pago menor que o pedido" };
    if (p.status !== "aguardando_pagamento" && p.status !== "cancelado") return { ok: true, status: p.status };
    let n = await mudarStatus(env, p, "pago", base);
    n = await moverEstoque(env, n, -1);
    await emails(env, request, n, "pago");
    return { ok: true, status: "pago" };
  }
  if (p.status !== "aguardando_pagamento") return { ok: true, status: p.status };
  const n = await mudarStatus(env, p, "aguardando_pagamento", base);
  if (r.estado === "aguardando" || r.estado === "analise") await emails(env, request, n, "aguardando");
  return { ok: true, status: "aguardando_pagamento" };
}

// ---------- E-mails (Resend) ----------
async function enviarEmail(env, para, assunto, html, responderPara) {
  const c = cfg(env);
  if (!c.resendKey || !para) return false;
  const r = await fetch(`${c.resendApi}/emails`, {
    method: "POST",
    headers: { authorization: "Bearer " + c.resendKey, "content-type": "application/json" },
    body: JSON.stringify({ from: c.remetente, to: [para], subject: assunto, html, ...((responderPara || c.responder) ? { reply_to: responderPara || c.responder } : {}) }),
  });
  return r.ok;
}
function moldura(titulo, corpo, origem) {
  return `<!doctype html><html><body style="margin:0;background:#ececea;font-family:Arial,Helvetica,sans-serif;color:#1b1a17">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#1b1a17;color:#d1ab5e;padding:18px 22px;border-radius:14px 14px 0 0;font-size:20px;letter-spacing:.04em">SP Store</div>
<div style="background:#fbfaf7;padding:24px 22px;border-radius:0 0 14px 14px;border:1px solid #d6d4ce;border-top:0">
<h1 style="font-size:21px;margin:0 0 12px;font-weight:600">${titulo}</h1>${corpo}
<p style="margin:24px 0 0;font-size:13px;color:#6a675f">Dúvidas? Responda este e-mail ou fale com a gente pelo WhatsApp.<br><a href="${origem}" style="color:#8a6a2c">${esc(new URL(origem).host)}</a></p>
</div></div></body></html>`;
}
function tabelaItens(p) {
  const linhas = (p.itens || []).map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e3dc">${i.qtd}× ${esc(i.nome)}${i.cor && i.cor !== "Padrão" ? `<br><span style="color:#6a675f;font-size:13px">${esc(i.cor)}</span>` : ""}${i.gratis ? `<br><span style="color:#17703c;font-size:13px">${i.gratis} grátis na promoção</span>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid #e6e3dc;text-align:right;white-space:nowrap">${reais(i.preco * (i.qtd - (i.gratis || 0)))}</td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:15px;margin:14px 0">${linhas}
<tr><td style="padding:8px 0;color:#6a675f">Frete</td><td style="padding:8px 0;text-align:right">${Number(p.frete) > 0 ? reais(p.frete) : "Grátis"}</td></tr>
${Number(p.subtotal) + Number(p.frete) - Number(p.total) > 0.004 ? `<tr><td style="padding:8px 0;color:#17703c">Desconto no Pix</td><td style="padding:8px 0;text-align:right;color:#17703c">- ${reais(Number(p.subtotal) + Number(p.frete) - Number(p.total))}</td></tr>` : ""}
<tr><td style="padding:8px 0;font-weight:700">Total</td><td style="padding:8px 0;text-align:right;font-weight:700">${reais(p.total)}</td></tr></table>`;
}
const enderecoTxt = a => a ? `${esc(a.rua)}, ${esc(a.numero)}${a.complemento ? " - " + esc(a.complemento) : ""}<br>${esc(a.bairro)} · ${esc(a.cidade)}/${esc(a.uf)} · CEP ${esc(String(a.cep).replace(/(\d{5})(\d{3})/, "$1-$2"))}` : "";
const botao = (url, txt) => `<p style="margin:20px 0"><a href="${url}" style="background:#1f9d55;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;display:inline-block">${txt}</a></p>`;

export async function emails(env, request, p, evento) {
  const c = cfg(env), origem = new URL(request.url).origin;
  const marcados = p.emails && typeof p.emails === "object" ? { ...p.emails } : {};
  if (marcados[evento]) return;
  const link = `${origem}/conta.html#pedido-${p.id}`;
  const n = `#${p.id}`;
  let ok = false;
  if (evento === "aguardando") {
    const pixBloco = p.pix_codigo ? `<p style="font-size:14px"><b>Pix copia e cola</b> (valor exato de ${reais(p.total)}${p.pix_nome ? `, para ${esc(p.pix_nome)}` : ""}):</p><p style="font-family:monospace;font-size:12px;word-break:break-all;background:#ececea;border-radius:10px;padding:10px">${esc(p.pix_codigo)}</p><p style="font-size:14px">Depois de pagar, toque em <b>“Já fiz o Pix”</b> na página do pedido. Assim que confirmarmos o recebimento, você recebe o e-mail de compra confirmada.</p>` : `<p>Assim que o pagamento for confirmado, você recebe outro e-mail.</p>`;
    ok = await enviarEmail(env, p.email, `Pedido ${n} recebido · aguardando pagamento`, moldura(`Recebemos seu pedido ${n}`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido foi registrado e está <b>aguardando o pagamento</b>.</p>${pixBloco}${tabelaItens(p)}${botao(link, "Ver pedido")}`, origem), c.lojaEmail);
  } else if (evento === "lembrete_pagamento") {
    const pagar = `${origem}/checkout.html?pedido=${p.id}&t=${p.token}`;
    ok = await enviarEmail(env, p.email, `Seu pedido ${n} está esperando por você`, moldura(`Faltou só o pagamento 😉`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido <b>${n}</b> ainda está separado, mas não recebemos o pagamento.</p><p>É só tocar no botão para finalizar com <b>Pix com desconto</b> ou <b>cartão em até 12x</b>. Os produtos ficam reservados por pouco tempo.</p>${tabelaItens(p)}${botao(pagar, "Finalizar meu pedido")}<p style="font-size:14px;color:#6a675f">Teve algum problema para pagar? Responda este e-mail ou chame a gente no WhatsApp que ajudamos.</p>`, origem), c.lojaEmail);
  } else if (evento === "pedir_avaliacao") {
    ok = await enviarEmail(env, p.email, `O que você achou do pedido ${n}?`, moldura(`Sua opinião vale muito ★`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido <b>${n}</b> já deve ter chegado. Pode contar pra gente o que achou?</p><p>Leva 30 segundos e ajuda outras clientes a escolher.</p>${botao(`${origem}/avaliar.html?pedido=${p.id}&t=${p.token}`, "★ Avaliar minha compra")}`, origem), c.lojaEmail);
  } else if (evento === "pix_conferir") {
    ok = c.lojaEmail ? await enviarEmail(env, c.lojaEmail, `Confira o Pix: pedido ${n} · ${reais(p.total)}`, moldura(`Cliente informou o Pix · ${n}`,
      `<p><b>${esc(p.nome)}</b> disse que pagou <b>${reais(p.total)}</b> por Pix (identificação <b>SPSTORE${p.id}</b>).</p><p>Confira no extrato do Mercado Pago e, se o valor entrou, toque em <b>Confirmar Pix recebido</b> no painel. O cliente recebe a confirmação na hora.</p>${tabelaItens(p)}${botao(origem + "/admin/pedidos.html", "Abrir painel de pedidos")}`, origem)) : false;
  } else if (evento === "pago") {
    ok = await enviarEmail(env, p.email, `Compra confirmada! Pedido ${n}`, moldura(`Pagamento aprovado ✓`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Obrigado pela compra. O pagamento do pedido <b>${n}</b> foi ${p.forma_pagamento === "Pix direto" ? "confirmado (Pix)" : `aprovado${p.forma_pagamento ? ` (${esc(p.forma_pagamento)})` : ""}`} e já estamos separando seus produtos.</p>${tabelaItens(p)}<p style="font-size:14px"><b>Entrega:</b><br>${enderecoTxt(p.endereco)}</p>${botao(link, "Acompanhar pedido")}<p style="font-size:14px;color:#6a675f">Quando o pedido for enviado, mandamos o código de rastreio por aqui.</p>`, origem), c.lojaEmail);
    if (c.lojaEmail) await enviarEmail(env, c.lojaEmail, `Nova venda! Pedido ${n} · ${reais(p.total)}`, moldura(`Nova venda paga · ${n}`,
      `<p><b>${esc(p.nome)}</b> · ${esc(p.email)} · ${esc(p.telefone)}</p>${tabelaItens(p)}<p style="font-size:14px"><b>Entregar em:</b><br>${enderecoTxt(p.endereco)}</p>${botao(origem + "/admin/pedidos.html", "Abrir painel de pedidos")}`, origem));
  } else if (evento === "enviado") {
    ok = await enviarEmail(env, p.email, p.envio && p.envio.id === "motoboy" ? `Seu pedido ${n} saiu para entrega` : `Seu pedido ${n} foi enviado`, moldura(p.envio && p.envio.id === "motoboy" ? `Saiu com o motoboy 🛵` : `Pedido enviado 📦`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido <b>${n}</b> saiu para entrega.</p>${p.envio && p.envio.id === "motoboy" ? `<p style="font-size:16px">🛵 Seu pedido está com o <b>motoboy</b> e chega <b>hoje</b>. Fique de olho no seu WhatsApp.</p>` : p.envio && p.envio.carro_proprio ? `<p style="font-size:16px">🚗 Seu pedido saiu com a <b>nossa equipe de entrega</b> e chega em breve. Fique de olho no seu WhatsApp.</p>` : ""}${p.envio && p.envio.empresa && p.envio.id !== "motoboy" && !p.envio.carro_proprio ? `<p style="font-size:14px">Transportadora: <b>${esc(p.envio.empresa)} ${esc(p.envio.nome)}</b>${p.envio.prazo ? ` · prazo estimado de ${p.envio.prazo} dias úteis` : ""}</p>` : ""}${p.rastreio ? `<p style="font-size:16px">Código de rastreio:<br><b style="font-size:20px;letter-spacing:.05em">${esc(p.rastreio)}</b></p>${botao("https://www.melhorrastreio.com.br/rastreio/" + encodeURIComponent(p.rastreio.split(",")[0].trim()), "Rastrear entrega")}` : ""}${tabelaItens(p)}${botao(link, "Acompanhar pedido")}`, origem), c.lojaEmail);
  } else if (evento === "entregue") {
    marcados.pedir_avaliacao = new Date().toISOString(); // o e-mail de entregue já pede a avaliação
    ok = await enviarEmail(env, p.email, `Pedido ${n} entregue`, moldura(`Pedido entregue`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! O pedido <b>${n}</b> consta como entregue. Esperamos que goste!</p><p>Pode contar pra gente o que achou? Leva 30 segundos e ajuda muito outras clientes a escolher.</p>${botao(`${origem}/avaliar.html?pedido=${p.id}&t=${p.token}`, "★ Avaliar minha compra")}<p style="font-size:14px;color:#6a675f">Se precisar de qualquer coisa, é só responder este e-mail.</p>`, origem), c.lojaEmail);
  } else if (evento === "cancelado") {
    ok = await enviarEmail(env, p.email, `Pedido ${n} cancelado`, moldura(`Pedido cancelado`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}. O pedido <b>${n}</b> foi cancelado. Se você já tinha pago, o valor é devolvido pelo Mercado Pago. Qualquer dúvida, responda este e-mail.</p>`, origem), c.lojaEmail);
  }
  if (ok) {
    marcados[evento] = new Date().toISOString();
    await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ emails: marcados }), headers: { prefer: "return=minimal" } }).catch(() => {});
  }
}

// ---------- fluxo de compra ----------
export async function checkout(env, request) {
  if (!pronto(env)) return erro("A loja ainda não está configurada para pagamento no site.", 503);
  const u = await usuario(env, request);
  if (!u) return erro("Entre na sua conta para finalizar a compra.", 401);
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  let entrega, itens, frete, envio, sub;
  try {
    entrega = validarEntrega(b, meAtivo(env));
    const { produtos, loja } = await catalogo(request, env);
    itens = aplicarPromo(montarItens(produtos, b.itens), produtos, loja);
    conferirEstoque(await lerEstoque(env), itens);
    sub = subtotalItens(itens);
    const rem = await lerConfig(env, "remetente");
    const ops = await cotar(env, { cepOrigem: rem && rem.cep, cepDestino: entrega.endereco.cep, itens, produtos, loja, subtotal: sub });
    const op = ops.find(o => o.id === String(b.frete_id || "")) || (ops.length === 1 ? ops[0] : null);
    if (!op) throw new Error("Escolha a forma de entrega.");
    frete = op.preco;
    const dist = await Promise.race([distanciaBase(env, sb, loja, entrega.endereco, rem && rem.cep).catch(() => null), new Promise(r => setTimeout(() => r(null), 3000))]);
    envio = { id: op.id, nome: op.nome, empresa: op.empresa, prazo: op.prazo, pacotes: op.pacotes || [], ...(op.prazo_txt ? { prazo_txt: op.prazo_txt, entrega_em: op.entrega_em } : {}), ...(dist ? { dist_base: dist } : {}) };
  } catch (e) { return erro(e.message); }
  const total = Math.round((sub + frete) * 100) / 100;
  const criado = await sb(env, "pedidos", {
    method: "POST",
    body: JSON.stringify({
      user_id: u.id, email: String(u.email || "").toLowerCase(), nome: entrega.nome, telefone: entrega.telefone,
      endereco: entrega.endereco, cpf: entrega.cpf || null, envio, itens, subtotal: sub, frete, total, status: "aguardando_pagamento",
      historico: [{ status: "aguardando_pagamento", em: new Date().toISOString() }], emails: {},
    }),
  });
  const p = criado[0];
  // guarda nome, telefone e endereço na conta para a próxima compra
  const c = cfg(env);
  fetch(`${c.sbUrl}/auth/v1/user`, { method: "PUT", headers: { apikey: c.sbAnon, authorization: request.headers.get("authorization"), "content-type": "application/json" },
    body: JSON.stringify({ data: { nome: entrega.nome, telefone: entrega.telefone, endereco: entrega.endereco, cpf: entrega.cpf || undefined } }) }).catch(() => {});
  return json({ ok: true, id: p.id, token: p.token, total: Number(p.total) });
}

// Paga um pedido (cartão ou Pix) dentro do site.
export async function pagar(env, request) {
  if (!pronto(env) || !cartaoPronto(env)) return erro("Pagamento com cartão indisponível no momento. Use o Pix.", 503);
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  const p = await buscarPedido(env, b.id);
  if (!p || p.token !== String(b.t || "")) return erro("Pedido não encontrado.", 404);
  if (p.status !== "aguardando_pagamento") return json({ ok: true, status: p.status, pedido: publico(p) });
  const ehPix = String((b.formData || {}).payment_method_id || "") === "pix";
  const { loja } = await catalogo(request, env);
  const certo = ehPix ? totalComPix(p, loja) : totalCheio(p);
  if (Number(p.total) !== certo) {
    const x = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ total: certo, ...(ehPix ? {} : { forma_pagamento: null }) }) }).catch(() => null);
    p.total = certo; if (x && x[0]) Object.assign(p, x[0]);
  }
  let d;
  try { d = await criarPagamento(env, request, p, b.formData || {}, b.tipo); }
  catch (e) { return erro(e.message, 402); }
  await aplicarPagamento(env, request, d, true);
  const atual = await buscarPedido(env, p.id), r = resumoOrder(d);
  if (r.estado === "aprovado") return json({ ok: true, status: "pago", pedido: publico(atual) });
  if (r.estado === "aguardando" && r.pix) return json({ ok: true, status: "pendente", pix: r.pix, pedido: publico(atual) });
  if (r.estado === "aguardando" || r.estado === "analise") return json({ ok: true, status: "pendente", aviso: "Pagamento em análise. Avisamos por e-mail assim que for aprovado.", pedido: publico(atual) });
  return json({ ok: false, status: "recusado", erro: motivoRecusa(r), pedido: publico(atual) });
}

// Confere no Mercado Pago o último pagamento do pedido (caso a notificação demore).
export async function conferir(env, request, p) {
  if (p.status !== "aguardando_pagamento" || !p.mp_pagamento) return p;
  try { const d = await buscarPagamento(env, p.mp_pagamento); if (d) await aplicarPagamento(env, request, d); } catch {}
  return (await buscarPedido(env, p.id)) || p;
}

// Opções de entrega para o CEP (mostradas no checkout)
export async function opcoesFrete(env, request) {
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  try {
    const { produtos, loja } = await catalogo(request, env);
    const itens = aplicarPromo(montarItens(produtos, b.itens), produtos, loja);
    const sub = subtotalItens(itens);
    const rem = pronto(env) ? await lerConfig(env, "remetente").catch(() => null) : null;
    const ops = await cotar(env, { cepOrigem: rem && rem.cep, cepDestino: b.cep, itens, produtos, loja, subtotal: sub });
    return json({ opcoes: ops.map(({ pacotes, ...o }) => o), exigeCpf: meAtivo(env) });
  } catch (e) { return erro(e.message || "Não foi possível calcular o frete."); }
}

// ---------- configurações privadas da loja (tabela config) ----------
export async function lerConfig(env, chave) {
  const r = await sb(env, `config?chave=eq.${encodeURIComponent(chave)}&select=valor`, { method: "GET" });
  return r && r[0] ? r[0].valor : null;
}
export async function gravarConfig(env, chave, valor) {
  await sb(env, "config?on_conflict=chave", { method: "POST", body: JSON.stringify({ chave, valor }), headers: { prefer: "resolution=merge-duplicates,return=minimal" } });
}
export async function salvarRemetente(env, b) { const r = validarRemetente(b); await gravarConfig(env, "remetente", r); return r; }
export async function infoEnvio(env) { return { remetente: await lerConfig(env, "remetente"), melhorEnvio: meAtivo(env), saldo: await saldo(env) }; }

export async function etiqueta(env, request, p, b) {
  if (!["pago", "enviado"].includes(p.status)) throw new Error("Só dá para gerar etiqueta de pedido pago.");
  if (p.envio && (p.envio.id === "motoboy" || p.envio.id === "fixo")) throw new Error("Este pedido não usa etiqueta do Melhor Envio.");
  const rem = await lerConfig(env, "remetente");
  if (!rem) throw new Error("Preencha primeiro as Configurações de envio (dados do remetente).");
  const { produtos } = await catalogo(request, env);
  const r = await gerarEtiqueta(env, { pedido: p, remetente: rem, produtos, nfe: b.nfe });
  const envio = { ...(p.envio || {}), me_ids: r.me_ids, etiqueta_url: r.etiqueta_url, etiqueta_em: (p.envio && p.envio.etiqueta_em) || new Date().toISOString() };
  const extra = { envio };
  if (r.rastreio) extra.rastreio = r.rastreio;
  let n;
  if (p.status === "pago" && (r.rastreio || p.rastreio)) { n = await mudarStatus(env, p, "enviado", extra); await emails(env, request, n, "enviado"); }
  else n = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(extra) }).then(x => x[0]);
  return { pedido: n, etiqueta_url: r.etiqueta_url };
}

// ---------- Pix direto na chave da loja ----------
export async function pixDireto(env, request) {
  if (!pronto(env)) return erro("Loja não configurada.", 503);
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  const p = await buscarPedido(env, b.id);
  if (!p || p.token !== String(b.t || "")) return erro("Pedido não encontrado.", 404);
  const { loja } = await catalogo(request, env);
  if (!pixAtivo(loja)) return erro("Pix indisponível no momento.", 503);
  if (p.status !== "aguardando_pagamento") return json({ ok: true, status: p.status, pedido: publico(p) });
  const valor = totalComPix(p, loja);
  const codigo = brCode({ chave: loja.pix_chave, nome: loja.pix_nome || "SP STORE", cidade: loja.pix_cidade || "SAO PAULO", valor, txid: `SPSTORE${p.id}`, mensagem: `Pedido ${p.id}` });
  let n = p;
  if (p.forma_pagamento !== "Pix direto" || Number(p.total) !== valor) {
    n = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ forma_pagamento: "Pix direto", total: valor }) }).then(x => x[0]);
  }
  if (b.informar) {
    const marc = { ...(n.emails || {}) };
    if (!marc.pix_informado) {
      marc.pix_informado = new Date().toISOString();
      n = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ emails: marc }) }).then(x => x[0]);
      await emails(env, request, n, "pix_conferir");
    }
  } else {
    await emails(env, request, { ...n, pix_codigo: codigo, pix_nome: loja.pix_nome }, "aguardando");
  }
  return json({ ok: true, status: "pendente", pix: { qr: codigo, nome: loja.pix_nome || "", chave: loja.pix_chave }, pedido: publico(n) });
}

export async function webhook(env, request) {
  const url = new URL(request.url);
  let b = {}; try { b = await request.json(); } catch {}
  const tipo = b.type || b.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const dataId = (b.data && b.data.id) || url.searchParams.get("data.id");
  if (tipo !== "order" || !dataId) return json({ ok: true, ignorado: tipo || "sem tipo" });
  if (!(await assinaturaValida(env, request, dataId))) return erro("assinatura inválida", 401);
  const ordem = await buscarPagamento(env, dataId);
  if (!ordem) return json({ ok: true, ignorado: "order não encontrada" });
  const r = await aplicarPagamento(env, request, ordem);
  return json({ ok: true, ...r });
}

export async function atualizarPeloAdmin(env, request, p, b) {
  const novo = String(b.status || p.status);
  if (!STATUS[novo]) throw new Error("Status inválido.");
  const extra = {};
  if (typeof b.rastreio === "string") extra.rastreio = so(b.rastreio, 40).toUpperCase();
  if (b.carro === true && novo === "enviado") extra.envio = { ...(p.envio || {}), carro_proprio: true };
  if (novo === "enviado" && !(extra.rastreio || p.rastreio) && !(p.envio && p.envio.id === "motoboy") && !b.carro) throw new Error("Informe o código de rastreio para marcar como enviado.");
  if (novo === "pago" && p.status !== "aguardando_pagamento") throw new Error("Este pedido não está aguardando pagamento.");
  let n = await mudarStatus(env, p, novo, extra);
  if (novo === "pago" && p.status !== "pago") n = await moverEstoque(env, n, -1);
  if (novo === "cancelado" && p.status !== "cancelado") n = await moverEstoque(env, n, +1);
  if (novo !== p.status && ["pago", "enviado", "entregue", "cancelado"].includes(novo)) await emails(env, request, n, novo);
  else if (novo === "enviado" && extra.rastreio && extra.rastreio !== p.rastreio && n.emails && n.emails.enviado) {
    // código corrigido depois do envio: manda de novo
    n.emails = { ...n.emails, enviado: null }; await emails(env, request, n, "enviado");
  }
  return n;
}
export { sb, ORDEM, meAtivo };
