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
  webhookSecret: String(env.MP_WEBHOOK_SECRET || ""),
});
export const pronto = env => { const c = cfg(env); return !!(c.sbUrl && c.sbAnon && c.sbService && c.mpToken && c.mpPublic); };
export const configPublica = env => { const c = cfg(env); return { pronto: pronto(env), supabaseUrl: c.sbUrl, supabaseAnonKey: c.sbAnon, mpPublicKey: c.mpPublic }; };

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
    subtotal: Number(p.subtotal), frete: Number(p.frete), total: Number(p.total),
    forma_pagamento: p.forma_pagamento, rastreio: p.rastreio || "", historico: p.historico || [], token: p.token,
    envio: p.envio ? { nome: p.envio.nome, empresa: p.envio.empresa, prazo: p.envio.prazo } : null,
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
export async function catalogo(request) {
  const base = new URL(request.url).origin;
  const [d, L] = await Promise.all([
    fetch(base + "/data/produtos.json", { cf: { cacheTtl: 0 } }).then(r => r.json()),
    fetch(base + "/data/loja.json", { cf: { cacheTtl: 0 } }).then(r => r.json()),
  ]);
  return { produtos: (d && d.produtos) || [], loja: L || {} };
}
export function calcularFrete(loja, subtotal) {
  const valor = Math.max(0, Number(loja.frete_valor) || 0);
  const gratisAcima = Math.max(0, Number(loja.frete_gratis_acima) || 0);
  if (gratisAcima > 0 && subtotal >= gratisAcima) return 0;
  return valor;
}
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
    else itens.push({ nome: p.nome, cor: v.nome, qtd, preco, foto: v.foto || "" });
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

// ---------- Mercado Pago ----------
// Checkout transparente: o navegador gera o token do cartão com o SDK do Mercado Pago
// (os dados do cartão não passam por aqui) e o servidor cria o pagamento com o valor do pedido.
const MOTIVOS = {
  cc_rejected_insufficient_amount: "Cartão sem limite suficiente.",
  cc_rejected_bad_filled_security_code: "Código de segurança (CVV) incorreto.",
  cc_rejected_bad_filled_date: "Data de validade incorreta.",
  cc_rejected_bad_filled_card_number: "Número do cartão incorreto.",
  cc_rejected_bad_filled_other: "Confira os dados do cartão.",
  cc_rejected_call_for_authorize: "O banco pediu autorização. Ligue para o banco do cartão e tente de novo.",
  cc_rejected_card_disabled: "Cartão bloqueado ou inativo. Fale com o banco.",
  cc_rejected_duplicated_payment: "Pagamento duplicado. Esse valor já foi pago com esse cartão.",
  cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro cartão ou o Pix.",
  cc_rejected_max_attempts: "Muitas tentativas. Use outro cartão ou o Pix.",
  cc_rejected_blacklist: "Pagamento recusado. Tente outro cartão ou o Pix.",
  cc_rejected_other_reason: "O banco recusou o pagamento. Tente outro cartão ou o Pix.",
};
export async function criarPagamento(env, request, p, f) {
  const c = cfg(env), origem = new URL(request.url).origin;
  const metodo = so(f.payment_method_id, 40);
  if (!metodo) throw new Error("Escolha a forma de pagamento.");
  const payerIn = f.payer || {};
  const ident = payerIn.identification && payerIn.identification.number
    ? { type: so(payerIn.identification.type || "CPF", 10), number: digitos(payerIn.identification.number).slice(0, 14) } : undefined;
  const [primeiro, ...resto] = p.nome.split(" ");
  const corpo = {
    transaction_amount: Number(p.total),
    description: `SP Store · Pedido #${p.id}`,
    payment_method_id: metodo,
    external_reference: String(p.id),
    notification_url: `${origem}/api/mp-webhook`,
    statement_descriptor: "SPSTORE",
    payer: { email: String(payerIn.email || p.email).slice(0, 120), first_name: primeiro, last_name: resto.join(" ") || primeiro, ...(ident ? { identification: ident } : {}) },
    additional_info: {
      items: p.itens.map((i, k) => ({ id: `item-${k + 1}`, title: so(`${i.nome}${i.cor && i.cor !== "Padrão" ? " - " + i.cor : ""}`, 250), quantity: i.qtd, unit_price: Number(i.preco) })),
      payer: { first_name: primeiro, last_name: resto.join(" ") || primeiro, phone: { area_code: p.telefone.slice(0, 2), number: p.telefone.slice(2) } },
      shipments: { receiver_address: { zip_code: p.endereco.cep, street_name: p.endereco.rua, street_number: p.endereco.numero, city_name: p.endereco.cidade, state_name: p.endereco.uf } },
    },
  };
  if (metodo === "pix") {
    corpo.date_of_expiration = new Date(Date.now() + 24 * 3600e3).toISOString().replace("Z", "-00:00");
  } else {
    if (!f.token) throw new Error("Dados do cartão incompletos.");
    corpo.token = String(f.token).slice(0, 200);
    corpo.installments = Math.min(12, Math.max(1, Math.floor(Number(f.installments) || 1)));
    if (f.issuer_id) corpo.issuer_id = String(f.issuer_id).slice(0, 20);
  }
  const r = await fetch(`${c.mpApi}/v1/payments`, {
    method: "POST",
    headers: { authorization: "Bearer " + c.mpToken, "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) {
    const causa = d.cause && d.cause[0] && (d.cause[0].description || d.cause[0].code);
    throw new Error("Não foi possível processar o pagamento" + (causa ? `: ${causa}` : ". Confira os dados e tente de novo."));
  }
  return d;
}
export const motivoRecusa = d => MOTIVOS[d.status_detail] || "Pagamento recusado. Confira os dados ou tente o Pix.";
export const dadosPix = d => {
  const t = d.point_of_interaction && d.point_of_interaction.transaction_data;
  return t ? { qr: t.qr_code || "", qr_base64: t.qr_code_base64 || "", expira: d.date_of_expiration || "" } : null;
};

export async function buscarPagamento(env, id) {
  const c = cfg(env);
  const r = await fetch(`${c.mpApi}/v1/payments/${encodeURIComponent(id)}`, { headers: { authorization: "Bearer " + c.mpToken } });
  if (r.status === 404) return null;
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
const FORMAS = { pix: "Pix", bank_transfer: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", ticket: "Boleto", account_money: "Saldo Mercado Pago" };

// Aplica um pagamento do Mercado Pago ao pedido. Usado pelo webhook e pela página do pedido.
export async function aplicarPagamento(env, request, pag) {
  const id = String(pag.external_reference || "");
  const p = await buscarPedido(env, id);
  if (!p) return { ignorado: "pedido não encontrado" };
  const forma = FORMAS[pag.payment_method_id] || FORMAS[pag.payment_type_id] || pag.payment_type_id || "";
  const base = { mp_pagamento: String(pag.id), mp_status: pag.status, forma_pagamento: forma };
  if (pag.status === "approved") {
    if (cents(pag.transaction_amount) + 1 < cents(p.total)) return { ignorado: "valor pago menor que o pedido" };
    if (p.status !== "aguardando_pagamento" && p.status !== "cancelado") return { ok: true, status: p.status };
    const n = await mudarStatus(env, p, "pago", base);
    await emails(env, request, n, "pago");
    return { ok: true, status: "pago" };
  }
  if (p.status !== "aguardando_pagamento") return { ok: true, status: p.status };
  if (pag.status === "pending" || pag.status === "in_process" || pag.status === "authorized") {
    const n = await mudarStatus(env, p, "aguardando_pagamento", base);
    await emails(env, request, n, "aguardando");
    return { ok: true, status: n.status };
  }
  // rejeitado/cancelado: o cliente ainda pode tentar pagar de novo; só registra
  await mudarStatus(env, p, "aguardando_pagamento", base);
  return { ok: true, status: "aguardando_pagamento" };
}

// ---------- E-mails (Resend) ----------
async function enviarEmail(env, para, assunto, html, responderPara) {
  const c = cfg(env);
  if (!c.resendKey || !para) return false;
  const r = await fetch(`${c.resendApi}/emails`, {
    method: "POST",
    headers: { authorization: "Bearer " + c.resendKey, "content-type": "application/json" },
    body: JSON.stringify({ from: c.remetente, to: [para], subject: assunto, html, ...(responderPara ? { reply_to: responderPara } : {}) }),
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
  const linhas = (p.itens || []).map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e3dc">${i.qtd}× ${esc(i.nome)}${i.cor && i.cor !== "Padrão" ? `<br><span style="color:#6a675f;font-size:13px">${esc(i.cor)}</span>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid #e6e3dc;text-align:right;white-space:nowrap">${reais(i.preco * i.qtd)}</td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:15px;margin:14px 0">${linhas}
<tr><td style="padding:8px 0;color:#6a675f">Frete</td><td style="padding:8px 0;text-align:right">${Number(p.frete) > 0 ? reais(p.frete) : "Grátis"}</td></tr>
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
    ok = await enviarEmail(env, p.email, `Pedido ${n} recebido · aguardando pagamento`, moldura(`Recebemos seu pedido ${n}`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido foi registrado e está <b>aguardando o pagamento</b>. Assim que o Mercado Pago confirmar, você recebe outro e-mail.</p>${tabelaItens(p)}${botao(link, "Acompanhar pedido")}`, origem), c.lojaEmail);
  } else if (evento === "pago") {
    ok = await enviarEmail(env, p.email, `Compra confirmada! Pedido ${n}`, moldura(`Pagamento aprovado ✓`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Obrigado pela compra. O pagamento do pedido <b>${n}</b> foi aprovado${p.forma_pagamento ? ` (${esc(p.forma_pagamento)})` : ""} e já estamos separando seus produtos.</p>${tabelaItens(p)}<p style="font-size:14px"><b>Entrega:</b><br>${enderecoTxt(p.endereco)}</p>${botao(link, "Acompanhar pedido")}<p style="font-size:14px;color:#6a675f">Quando o pedido for enviado, mandamos o código de rastreio por aqui.</p>`, origem), c.lojaEmail);
    if (c.lojaEmail) await enviarEmail(env, c.lojaEmail, `Nova venda! Pedido ${n} · ${reais(p.total)}`, moldura(`Nova venda paga · ${n}`,
      `<p><b>${esc(p.nome)}</b> · ${esc(p.email)} · ${esc(p.telefone)}</p>${tabelaItens(p)}<p style="font-size:14px"><b>Entregar em:</b><br>${enderecoTxt(p.endereco)}</p>${botao(origem + "/admin/pedidos.html", "Abrir painel de pedidos")}`, origem));
  } else if (evento === "enviado") {
    ok = await enviarEmail(env, p.email, `Seu pedido ${n} foi enviado`, moldura(`Pedido enviado 📦`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! Seu pedido <b>${n}</b> saiu para entrega.</p>${p.envio && p.envio.empresa ? `<p style="font-size:14px">Transportadora: <b>${esc(p.envio.empresa)} ${esc(p.envio.nome)}</b>${p.envio.prazo ? ` · prazo estimado de ${p.envio.prazo} dias úteis` : ""}</p>` : ""}${p.rastreio ? `<p style="font-size:16px">Código de rastreio:<br><b style="font-size:20px;letter-spacing:.05em">${esc(p.rastreio)}</b></p>${botao("https://www.melhorrastreio.com.br/rastreio/" + encodeURIComponent(p.rastreio.split(",")[0].trim()), "Rastrear entrega")}` : ""}${tabelaItens(p)}${botao(link, "Acompanhar pedido")}`, origem), c.lojaEmail);
  } else if (evento === "entregue") {
    ok = await enviarEmail(env, p.email, `Pedido ${n} entregue`, moldura(`Pedido entregue`,
      `<p>Olá, ${esc(p.nome.split(" ")[0])}! O pedido <b>${n}</b> consta como entregue. Esperamos que goste! Se precisar de qualquer coisa, é só responder este e-mail.</p>${botao(origem, "Voltar à loja")}`, origem), c.lojaEmail);
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
    const { produtos, loja } = await catalogo(request);
    itens = montarItens(produtos, b.itens);
    sub = itens.reduce((a, i) => a + cents(i.preco) * i.qtd, 0) / 100;
    const rem = await lerConfig(env, "remetente");
    const ops = await cotar(env, { cepOrigem: rem && rem.cep, cepDestino: entrega.endereco.cep, itens, produtos, loja, subtotal: sub });
    const op = ops.find(o => o.id === String(b.frete_id || "")) || (ops.length === 1 ? ops[0] : null);
    if (!op) throw new Error("Escolha a forma de entrega.");
    frete = op.preco;
    envio = { id: op.id, nome: op.nome, empresa: op.empresa, prazo: op.prazo, pacotes: op.pacotes || [] };
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
  if (!pronto(env)) return erro("Pagamento indisponível no momento.", 503);
  let b; try { b = await request.json(); } catch { return erro("Pedido inválido."); }
  const p = await buscarPedido(env, b.id);
  if (!p || p.token !== String(b.t || "")) return erro("Pedido não encontrado.", 404);
  if (p.status !== "aguardando_pagamento") return json({ ok: true, status: p.status, pedido: publico(p) });
  let d;
  try { d = await criarPagamento(env, request, p, b.formData || {}); }
  catch (e) { return erro(e.message, 402); }
  const r = await aplicarPagamento(env, request, d);
  const atual = await buscarPedido(env, p.id);
  if (d.status === "approved") return json({ ok: true, status: "pago", pedido: publico(atual) });
  if (d.status === "pending" || d.status === "in_process") return json({ ok: true, status: "pendente", pix: dadosPix(d), aviso: d.status === "in_process" ? "Pagamento em análise. Avisamos por e-mail assim que for aprovado." : "", pedido: publico(atual) });
  return json({ ok: false, status: "recusado", erro: motivoRecusa(d), pedido: publico(atual) });
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
    const { produtos, loja } = await catalogo(request);
    const itens = montarItens(produtos, b.itens);
    const sub = itens.reduce((a, i) => a + cents(i.preco) * i.qtd, 0) / 100;
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
  const rem = await lerConfig(env, "remetente");
  if (!rem) throw new Error("Preencha primeiro as Configurações de envio (dados do remetente).");
  const { produtos } = await catalogo(request);
  const r = await gerarEtiqueta(env, { pedido: p, remetente: rem, produtos, nfe: b.nfe });
  const envio = { ...(p.envio || {}), me_ids: r.me_ids, etiqueta_url: r.etiqueta_url, etiqueta_em: (p.envio && p.envio.etiqueta_em) || new Date().toISOString() };
  const extra = { envio };
  if (r.rastreio) extra.rastreio = r.rastreio;
  let n;
  if (p.status === "pago" && (r.rastreio || p.rastreio)) { n = await mudarStatus(env, p, "enviado", extra); await emails(env, request, n, "enviado"); }
  else n = await sb(env, `pedidos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(extra) }).then(x => x[0]);
  return { pedido: n, etiqueta_url: r.etiqueta_url };
}

export async function webhook(env, request) {
  const url = new URL(request.url);
  let b = {}; try { b = await request.json(); } catch {}
  const tipo = b.type || b.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const dataId = (b.data && b.data.id) || url.searchParams.get("data.id") || (tipo === "payment" ? url.searchParams.get("id") : null);
  if (tipo !== "payment" || !dataId) return json({ ok: true, ignorado: tipo || "sem tipo" });
  if (!(await assinaturaValida(env, request, dataId))) return erro("assinatura inválida", 401);
  const pag = await buscarPagamento(env, dataId);
  if (!pag) return json({ ok: true, ignorado: "pagamento não encontrado" });
  const r = await aplicarPagamento(env, request, pag);
  return json({ ok: true, ...r });
}

export async function atualizarPeloAdmin(env, request, p, b) {
  const novo = String(b.status || p.status);
  if (!STATUS[novo]) throw new Error("Status inválido.");
  const extra = {};
  if (typeof b.rastreio === "string") extra.rastreio = so(b.rastreio, 40).toUpperCase();
  if (novo === "enviado" && !(extra.rastreio || p.rastreio)) throw new Error("Informe o código de rastreio para marcar como enviado.");
  const n = await mudarStatus(env, p, novo, extra);
  if (novo !== p.status && ["enviado", "entregue", "cancelado"].includes(novo)) await emails(env, request, n, novo);
  else if (novo === "enviado" && extra.rastreio && extra.rastreio !== p.rastreio && n.emails && n.emails.enviado) {
    // código corrigido depois do envio: manda de novo
    n.emails = { ...n.emails, enviado: null }; await emails(env, request, n, "enviado");
  }
  return n;
}
export { sb, ORDEM, meAtivo };
