// SP Store · avaliações de clientes. Só quem comprou (pedido enviado/entregue) avalia, e só aparece no site depois de aprovada no painel.
// Guardadas na tabela config (chave "avaliacoes"), sem precisar criar tabela nova.
import { lerConfig, gravarConfig, buscarPedido } from "./loja.js";

const txt = (t, n) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, n);
export const podeAvaliar = p => p && ["enviado", "entregue"].includes(p.status);

async function ler(env) { const v = await lerConfig(env, "avaliacoes").catch(() => null); return Array.isArray(v && v.lista) ? v.lista : []; }
async function gravar(env, lista) { await gravarConfig(env, "avaliacoes", { lista: lista.slice(-3000) }); }

const nomePublico = (nome, end) => {
  const [a, ...r] = String(nome || "Cliente").trim().split(/\s+/);
  const ini = r.length ? " " + r[r.length - 1][0].toUpperCase() + "." : "";
  const lugar = end && end.cidade ? ` · ${txt(end.cidade, 40)}/${txt(end.uf, 2).toUpperCase()}` : "";
  return txt(a, 30) + ini + lugar;
};

// O que o cliente já avaliou neste pedido (para a página de avaliação)
export async function doPedido(env, p) {
  const lista = await ler(env);
  return lista.filter(a => a.pedido === p.id).map(a => ({ produto: a.produto, cor: a.cor, nota: a.nota, texto: a.texto, status: a.status }));
}

export async function enviar(env, id, token, itens) {
  const p = await buscarPedido(env, id);
  if (!p || p.token !== String(token || "")) throw new Error("Pedido não encontrado.");
  if (!podeAvaliar(p)) throw new Error("Você poderá avaliar assim que o pedido for enviado.");
  const lista = await ler(env);
  let novas = 0;
  for (const it of (Array.isArray(itens) ? itens : []).slice(0, 30)) {
    const item = (p.itens || []).find(i => i.nome === it.produto && (!it.cor || i.cor === it.cor));
    const nota = Math.round(Number(it.nota));
    if (!item || !(nota >= 1 && nota <= 5)) continue;
    const texto = txt(it.texto, 600);
    const ja = lista.find(a => a.pedido === p.id && a.produto === item.nome && a.cor === item.cor);
    if (ja) { // pode corrigir enquanto não foi aprovada
      if (ja.status === "aprovada") continue;
      Object.assign(ja, { nota, texto, em: new Date().toISOString(), status: "pendente" }); novas++; continue;
    }
    lista.push({ id: `${p.id}-${lista.length + 1}-${Date.now().toString(36)}`, pedido: p.id, produto: item.nome, cor: item.cor, nota, texto,
      nome: nomePublico(p.nome, p.endereco), em: new Date().toISOString(), status: "pendente" });
    novas++;
  }
  if (!novas) throw new Error("Escolha de 1 a 5 estrelas para pelo menos um produto.");
  await gravar(env, lista);
  return novas;
}

// Resumo público: só aprovadas
export async function resumoPublico(env) {
  const lista = (await ler(env)).filter(a => a.status === "aprovada");
  const por = {};
  for (const a of lista) {
    const r = por[a.produto] = por[a.produto] || { soma: 0, qtd: 0, ultimas: [] };
    r.soma += a.nota; r.qtd++;
    r.ultimas.push({ nota: a.nota, texto: a.texto, nome: a.nome, cor: a.cor, em: a.em });
  }
  let soma = 0, qtd = 0;
  for (const k in por) {
    const r = por[k]; soma += r.soma; qtd += r.qtd;
    r.media = Math.round((r.soma / r.qtd) * 10) / 10;
    r.ultimas = r.ultimas.sort((a, b) => (b.texto ? 1 : 0) - (a.texto ? 1 : 0) || String(b.em).localeCompare(String(a.em))).slice(0, 20);
    delete r.soma;
  }
  return { produtos: por, loja: qtd ? { media: Math.round((soma / qtd) * 10) / 10, qtd } : null };
}

export async function listaAdmin(env) { return (await ler(env)).slice().reverse(); }
export async function moderar(env, id, status) {
  if (!["aprovada", "recusada", "pendente", "excluir"].includes(status)) throw new Error("Status inválido.");
  const lista = await ler(env);
  const i = lista.findIndex(a => a.id === id);
  if (i < 0) throw new Error("Avaliação não encontrada.");
  if (status === "excluir") lista.splice(i, 1); else lista[i].status = status;
  await gravar(env, lista);
}
