// Cria o pagamento no Mercado Pago (cartão) para o carrinho do site.
// Os preços são lidos de data/produtos.json aqui no servidor; o preço enviado
// pelo navegador é ignorado, para ninguém conseguir alterar o valor.
// Precisa da variável MP_ACCESS_TOKEN no Cloudflare Pages
// (Settings > Variables and Secrets, tipo "Secret").

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const limpa = (t, max = 120) => String(t ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const cents = (n) => Math.round(Number(n) * 100);

async function lerJson(env, origin, caminho) {
  const url = new URL(caminho, origin);
  const r = env.ASSETS ? await env.ASSETS.fetch(url) : await fetch(url);
  if (!r.ok) throw new Error("Não consegui ler " + caminho);
  return r.json();
}

export async function onRequestPost({ request, env }) {
  if (!env.MP_ACCESS_TOKEN) {
    return json({ erro: "Pagamento com cartão ainda não configurado na loja." }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }

  const origin = new URL(request.url).origin;
  const itensPedido = Array.isArray(body.itens) ? body.itens.slice(0, 50) : [];
  const c = body.cliente || {};
  const cliente = {
    nome: limpa(c.nome, 80), email: limpa(c.email, 120), telefone: limpa(c.telefone, 20).replace(/\D/g, ""),
    cep: limpa(c.cep, 9).replace(/\D/g, ""), endereco: limpa(c.endereco), numero: limpa(c.numero, 20),
    complemento: limpa(c.complemento, 60), bairro: limpa(c.bairro, 60), cidade: limpa(c.cidade, 60), uf: limpa(c.uf, 2).toUpperCase(),
  };
  if (!cliente.nome || !/^\S+@\S+\.\S+$/.test(cliente.email) || cliente.cep.length !== 8 || !cliente.endereco || !cliente.numero || !cliente.cidade) {
    return json({ erro: "Preencha nome, e-mail e endereço completo." }, 400);
  }

  let produtos, loja;
  try {
    [produtos, loja] = await Promise.all([lerJson(env, origin, "/data/produtos.json"), lerJson(env, origin, "/data/loja.json")]);
  } catch (e) {
    return json({ erro: "Não consegui carregar os produtos. Tente de novo." }, 502);
  }
  const lista = (produtos.produtos || []).filter((p) => p.ativo !== false);

  const items = [];
  for (const it of itensPedido) {
    const p = lista.find((x) => x.nome === it.nome);
    if (!p) return json({ erro: `O produto "${limpa(it.nome)}" não está mais disponível.` }, 409);
    const vs = p.variantes && p.variantes.length ? p.variantes : [{ nome: "Padrão" }];
    const v = vs.find((x) => x.nome === it.cor);
    if (!v) return json({ erro: `A cor "${limpa(it.cor)}" de ${p.nome} não está mais disponível.` }, 409);
    const qtd = Math.max(1, Math.min(99, parseInt(it.qtd, 10) || 1));
    const titulo = v.nome && v.nome !== "Padrão" ? `${p.nome} - ${v.nome}` : p.nome;
    items.push({
      id: limpa(titulo, 250), title: limpa(titulo, 250), quantity: qtd, currency_id: "BRL",
      unit_price: cents(p.preco) / 100, category_id: "fashion",
      ...(v.foto ? { picture_url: new URL(v.foto, origin).href } : {}),
    });
  }
  if (!items.length) return json({ erro: "Seu carrinho está vazio." }, 400);

  const frete = cents(loja.frete_fixo || 0) / 100;
  if (frete > 0) items.push({ id: "frete", title: "Frete", quantity: 1, currency_id: "BRL", unit_price: frete });

  const pedido = "SP" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const endTxt = `${cliente.endereco}, ${cliente.numero}${cliente.complemento ? " - " + cliente.complemento : ""}, ${cliente.bairro} - ${cliente.cidade}/${cliente.uf} - CEP ${cliente.cep}`;
  const [primeiro, ...resto] = cliente.nome.split(/\s+/);

  const preferencia = {
    items,
    external_reference: pedido,
    statement_descriptor: "SPSTORE",
    payer: {
      name: primeiro, surname: resto.join(" "), email: cliente.email,
      ...(cliente.telefone.length >= 10 ? { phone: { area_code: cliente.telefone.slice(-11, -9) || cliente.telefone.slice(0, 2), number: cliente.telefone.slice(-9) } } : {}),
      address: { zip_code: cliente.cep, street_name: cliente.endereco, street_number: cliente.numero },
    },
    additional_info: limpa(`Entrega: ${endTxt} | Tel: ${cliente.telefone}`, 600),
    metadata: { pedido, cliente_nome: cliente.nome, cliente_telefone: cliente.telefone, entrega: endTxt },
    back_urls: {
      success: `${origin}/?pagamento=aprovado&pedido=${pedido}`,
      pending: `${origin}/?pagamento=pendente&pedido=${pedido}`,
      failure: `${origin}/?pagamento=recusado&pedido=${pedido}`,
    },
    auto_return: "approved",
    payment_methods: { installments: 12 },
  };

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "x-idempotency-key": pedido,
    },
    body: JSON.stringify(preferencia),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.init_point) {
    console.log("Erro Mercado Pago", r.status, JSON.stringify(d).slice(0, 500));
    return json({ erro: "O Mercado Pago não respondeu agora. Tente de novo em instantes." }, 502);
  }
  // Credencial de teste devolve sandbox_init_point; a de produção, init_point.
  const teste = String(env.MP_ACCESS_TOKEN).startsWith("TEST-");
  return json({ pedido, url: teste && d.sandbox_init_point ? d.sandbox_init_point : d.init_point });
}
