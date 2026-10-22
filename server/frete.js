// =============== SP Store · frete e etiquetas (Melhor Envio) ===============
// Variáveis no Cloudflare:
//   ME_TOKEN        token gerado no painel do Melhor Envio (Integrações > Permissões de acesso)  [Secret]
//   ME_API          opcional. Padrão https://melhorenvio.com.br (teste: https://sandbox.melhorenvio.com.br)
//   ME_CEP_ORIGEM   opcional. CEP de onde saem os pacotes (padrão: o das Configurações de envio, ou 08020360)

const PADRAO = { peso_g: 400, largura_cm: 11, altura_cm: 4, comprimento_cm: 16 };
const digitos = t => String(t ?? "").replace(/\D/g, "");
const so = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const cfg = env => ({
  token: String(env.ME_TOKEN || ""),
  api: String(env.ME_API || "https://melhorenvio.com.br").replace(/\/+$/, ""),
  cepOrigem: digitos(env.ME_CEP_ORIGEM || ""),
  contato: String(env.LOJA_EMAIL || "contato@lojaspstore.com.br"),
});
export const meAtivo = env => !!cfg(env).token;

async function me(env, caminho, metodo = "GET", corpo) {
  const c = cfg(env);
  const r = await fetch(`${c.api}/api/v2/me${caminho}`, {
    method: metodo,
    headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer " + c.token, "user-agent": `SP Store (${c.contato})` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  let d; try { d = txt ? JSON.parse(txt) : {}; } catch { d = { message: txt.slice(0, 200) }; }
  if (!r.ok) {
    const det = d.errors ? Object.values(d.errors).flat().join(" ") : "";
    const e = new Error(traduzir(det || d.message || d.error || `Melhor Envio respondeu ${r.status}`));
    e.status = r.status; throw e;
  }
  return d;
}
function traduzir(m) {
  if (/saldo|balance|insufficient/i.test(m)) return "Saldo insuficiente no Melhor Envio. Adicione saldo na sua carteira do Melhor Envio e tente de novo.";
  if (/unauthenticated|token/i.test(m)) return "O token do Melhor Envio expirou ou é inválido. Gere um novo no painel do Melhor Envio.";
  return m;
}

// Identifica o serviço para o filtro de transportadoras do painel
export function chaveServico(s) {
  const emp = String((s.company && s.company.name) || s.empresa || "").toLowerCase(), nome = String(s.name || s.nome || "").toLowerCase();
  if (emp.includes("correios")) return /sedex/.test(nome) ? "correios-sedex" : /mini/.test(nome) ? "correios-mini" : "correios-pac";
  if (emp.includes("jadlog")) return /package/.test(nome) ? "jadlog-package" : "jadlog-com";
  if (emp.includes("loggi")) return "loggi";
  if (emp.includes("j&t") || emp.includes("jet")) return "jet";
  return "outra-" + emp.replace(/[^a-z0-9]/g, "");
}
export function permitido(loja, s) {
  const lista = Array.isArray(loja.frete_transportadoras) ? loja.frete_transportadoras.filter(Boolean) : [];
  return !lista.length || lista.includes(chaveServico(s));
}

// Região pelo 1º dígito do CEP: 0-1 SP, 2 RJ/ES, 3 MG (Sudeste) · 8 PR/SC, 9 RS (Sul)
// 4 BA/SE, 5 PE/AL/PB/RN, 6 CE/PI/MA/PA/AP/AM/RR/AC (Nordeste/Norte) · 7 DF/GO/TO/MT/MS/RO (Centro-Oeste/Norte)
export function regiaoCep(cep) {
  const d = digitos(cep)[0];
  return "0123".includes(d) ? "sudeste" : "89".includes(d) ? "sul" : d ? "outras" : "";
}
// regiões com frete grátis (painel › Banner e textos). Vazio = Brasil todo.
export function regiaoTemGratis(loja, cep) {
  const lista = Array.isArray(loja.frete_gratis_regioes) ? loja.frete_gratis_regioes.filter(Boolean) : [];
  return !lista.length || lista.includes(regiaoCep(cep));
}
// ---------- Motoboy (entrega no mesmo dia na Grande SP) ----------
// loja.motoboy_faixas: uma faixa por linha, ex. "Guarulhos: 07000-000 a 07399-999" ou "03310-000" ou "033"
export function faixasMotoboy(loja) {
  return String(loja.motoboy_faixas || "").split(/\n|;/).map(l => {
    const t = l.replace(/^[^:]*:/, "").trim(); const m = t.match(/(\d[\d-]*)\s*(?:a|-|até|ate|–)\s*(\d[\d-]*)$/i);
    if (m) { const a = digitos(m[1]), b = digitos(m[2]); return a.length === 8 && b.length === 8 ? [a, b] : null; }
    const d = digitos(t); if (!d) return null;
    return d.length >= 8 ? [d.slice(0, 8), d.slice(0, 8)] : [d.padEnd(8, "0"), d.padEnd(8, "9")];
  }).filter(Boolean);
}
export const cepNoMotoboy = (loja, cep) => { const c = digitos(cep); return c.length === 8 && faixasMotoboy(loja).some(([a, b]) => c >= a && c <= b); };
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
// Quando o motoboy entrega: hoje (antes do horário de corte, em dia de entrega) ou o próximo dia de entrega.
export function previsaoMotoboy(loja, agora = new Date()) {
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dias = Array.isArray(loja.motoboy_dias) && loja.motoboy_dias.length ? loja.motoboy_dias.map(Number) : [1, 2, 3, 4, 5, 6];
  const [hh, mm] = String(loja.motoboy_corte || "13:00").split(":").map(Number);
  const antesDoCorte = sp.getHours() * 60 + sp.getMinutes() < (hh || 0) * 60 + (mm || 0);
  for (let k = 0; k < 8; k++) {
    const d = new Date(sp); d.setDate(sp.getDate() + k);
    if (!dias.includes(d.getDay()) || (k === 0 && !antesDoCorte)) continue;
    const data = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const quando = k === 0 ? "hoje" : k === 1 ? "amanhã" : DIAS[d.getDay()];
    return { k, quando, data, texto: k === 0 ? `Chega hoje (${data})` : `Chega ${quando} (${data})` };
  }
  return null;
}
export function opcaoMotoboy(loja, cep, agora) {
  if (!loja.motoboy_ativo || !cepNoMotoboy(loja, cep)) return null;
  const p = previsaoMotoboy(loja, agora); if (!p) return null;
  return { id: "motoboy", nome: "Motoboy", empresa: p.k === 0 ? "Entrega hoje" : `Entrega ${p.quando}`, logo: "", preco: Math.round(Math.max(0, Number(loja.motoboy_valor ?? 10)) * 100) / 100,
    prazo: null, prazo_txt: p.texto, entrega_em: p.data, gratis: false };
}

export function medidas(produto) {
  const a = (produto && produto.avancado) || {};
  const n = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return { peso_g: n(a.peso_g, PADRAO.peso_g), largura_cm: n(a.largura_cm, PADRAO.largura_cm), altura_cm: n(a.altura_cm, PADRAO.altura_cm), comprimento_cm: n(a.comprimento_cm, PADRAO.comprimento_cm) };
}

// itens: [{nome, cor, qtd, preco}] já conferidos pelo servidor
export async function cotar(env, { cepOrigem, cepDestino, itens, produtos, loja, subtotal }) {
  const destino = digitos(cepDestino);
  if (destino.length !== 8) throw new Error("CEP inválido.");
  const dias = Math.max(0, Math.floor(Number(loja.dias_para_postar ?? 1)));
  const gratisAcima = Math.max(0, Number(loja.frete_gratis_acima) || 0);
  const gratis = gratisAcima > 0 && subtotal >= gratisAcima && regiaoTemGratis(loja, destino);
  const moto = opcaoMotoboy(loja, destino);
  if (!meAtivo(env)) {
    const v = gratis ? 0 : Math.max(0, Number(loja.frete_valor) || 0);
    return [...(moto ? [moto] : []), { id: "fixo", nome: "Entrega padrão", empresa: "", logo: "", preco: v, prazo: null, gratis: v === 0 }];
  }
  const corpo = {
    from: { postal_code: digitos(cepOrigem || cfg(env).cepOrigem || "08020360") },
    to: { postal_code: destino },
    products: itens.map((i, k) => {
      const m = medidas(produtos.find(p => p.nome === i.nome));
      return { id: `p${k + 1}`, width: m.largura_cm, height: m.altura_cm, length: m.comprimento_cm, weight: m.peso_g / 1000, insurance_value: Number(i.preco), quantity: i.qtd };
    }),
    options: { receipt: false, own_hand: false },
  };
  const lista = await me(env, "/shipment/calculate", "POST", corpo);
  let ops = (Array.isArray(lista) ? lista : []).filter(s => s && !s.error && s.id != null && (s.custom_price ?? s.price) != null && permitido(loja, s))
    .map(s => ({
      id: String(s.id), nome: so(s.name, 40), empresa: so(s.company && s.company.name, 40), logo: (s.company && s.company.picture) || "",
      preco: Math.round(Number(s.custom_price ?? s.price) * 100) / 100,
      prazo: Number(s.custom_delivery_time ?? s.delivery_time) + dias,
      pacotes: (s.packages || []).map(p => ({ altura: Number(p.dimensions && p.dimensions.height), largura: Number(p.dimensions && p.dimensions.width), comprimento: Number(p.dimensions && p.dimensions.length), peso: Number(p.weight) })),
    }))
    .sort((a, b) => a.preco - b.preco);
  if (!ops.length && !moto) throw new Error("Não encontramos opções de entrega para este CEP.");
  if (gratis && ops.length) ops[0] = { ...ops[0], preco: 0, gratis: true };
  // motoboy primeiro e sempre com o valor dele (não entra no frete grátis)
  return moto ? [moto, ...ops] : ops;
}

// ---------- etiqueta ----------
function volumesDe(pedido, produtos) {
  const pac = (pedido.envio && pedido.envio.pacotes) || [];
  if (pac.length && pac.every(p => p.altura > 0 && p.largura > 0 && p.comprimento > 0 && p.peso > 0))
    return pac.map(p => ({ height: p.altura, width: p.largura, length: p.comprimento, weight: p.peso }));
  // sem a caixa da cotação: empilha os itens numa caixa só
  let peso = 0, alt = 0, larg = 11, comp = 16;
  for (const i of pedido.itens) { const m = medidas(produtos.find(p => p.nome === i.nome)); peso += (m.peso_g / 1000) * i.qtd; alt += m.altura_cm * i.qtd; larg = Math.max(larg, m.largura_cm); comp = Math.max(comp, m.comprimento_cm); }
  return [{ height: Math.max(2, Math.ceil(alt)), width: larg, length: comp, weight: Math.round(peso * 1000) / 1000 }];
}
export function validarRemetente(r) {
  const x = {
    nome: so(r.nome, 80), cnpj: digitos(r.cnpj), ie: so(r.ie, 20), telefone: digitos(r.telefone), email: so(r.email, 120),
    cep: digitos(r.cep), rua: so(r.rua, 120), numero: so(r.numero, 20), complemento: so(r.complemento, 60), bairro: so(r.bairro, 80), cidade: so(r.cidade, 80), uf: so(r.uf, 2).toUpperCase(),
  };
  if (x.nome.length < 3) throw new Error("Informe a razão social ou o nome da loja.");
  if (x.cnpj.length !== 14) throw new Error("CNPJ precisa ter 14 números.");
  if (x.telefone.length < 10) throw new Error("Informe o telefone com DDD.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) throw new Error("E-mail inválido.");
  if (x.cep.length !== 8 || !x.rua || !x.numero || !x.bairro || !x.cidade || !/^[A-Z]{2}$/.test(x.uf)) throw new Error("Preencha o endereço completo de envio.");
  return x;
}

export async function gerarEtiqueta(env, { pedido, remetente, produtos, nfe }) {
  if (!meAtivo(env)) throw new Error("Melhor Envio não configurado (falta o ME_TOKEN no Cloudflare).");
  const envio = pedido.envio || {};
  if (!envio.id || envio.id === "fixo") throw new Error("Este pedido não tem um serviço do Melhor Envio escolhido.");
  const r = remetente, a = pedido.endereco || {};
  const chave = digitos(nfe);
  if (chave && chave.length !== 44) throw new Error("A chave da NF-e tem 44 números.");
  let ids = Array.isArray(envio.me_ids) ? envio.me_ids.slice() : [];
  if (!ids.length) {
    const volumes = volumesDe(pedido, produtos);
    const produtosEt = pedido.itens.map(i => ({ name: so(`${i.nome}${i.cor && i.cor !== "Padrão" ? " " + i.cor : ""}`, 60), quantity: String(i.qtd), unitary_value: String(Number(i.preco).toFixed(2)) }));
    const seguro = Number(pedido.subtotal);
    for (const [k, vol] of volumes.entries()) {
      const corpo = {
        service: Number(envio.id),
        from: { name: r.nome, email: r.email, phone: r.telefone, company_document: r.cnpj, state_register: chave ? (r.ie || "") : (r.ie || "ISENTO"), address: r.rua, complement: r.complemento, number: r.numero, district: r.bairro, city: r.cidade, postal_code: r.cep, state_abbr: r.uf, country_id: "BR" },
        to: { name: pedido.nome, email: pedido.email, phone: pedido.telefone, document: digitos(pedido.cpf), address: a.rua, complement: a.complemento, number: a.numero, district: a.bairro, city: a.cidade, postal_code: a.cep, state_abbr: a.uf, country_id: "BR" },
        products: k === 0 ? produtosEt : [{ name: "Continuação do pedido", quantity: "1", unitary_value: "1.00" }],
        volumes: [vol],
        options: {
          platform: "SP Store", insurance_value: Math.round((k === 0 ? seguro : 1) * 100) / 100, receipt: false, own_hand: false, reverse: false,
          tags: [{ tag: `Pedido #${pedido.id}`, url: null }],
          ...(chave ? { invoice: { key: chave } } : {}),
        },
      };
      const d = await me(env, "/cart", "POST", corpo);
      if (!d.id) throw new Error("Melhor Envio não devolveu o número da etiqueta.");
      ids.push(String(d.id));
    }
    await me(env, "/shipment/checkout", "POST", { orders: ids });
  }
  // gerar (se já foi gerada, o Melhor Envio só confirma) e imprimir
  try { await me(env, "/shipment/generate", "POST", { orders: ids }); } catch (e) { if (e.status !== 422) throw e; }
  const imp = await me(env, "/shipment/print", "POST", { mode: "private", orders: ids });
  const codigos = [];
  for (const id of ids) {
    try { const o = await me(env, `/orders/${encodeURIComponent(id)}`); const c = o.tracking || o.self_tracking || o.protocol; if (c) codigos.push(String(c)); } catch {}
  }
  return { me_ids: ids, etiqueta_url: imp.url || "", rastreio: codigos.join(", ") };
}

export async function saldo(env) {
  if (!meAtivo(env)) return null;
  try { const d = await me(env, "/balance"); return Number(d.balance ?? d.saldo ?? 0); } catch { return null; }
}
