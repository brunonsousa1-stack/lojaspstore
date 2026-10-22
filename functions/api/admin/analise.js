// Painel › Análise: visitas, origens, funil, CTR por produto e vendas do período.
import { json, erro, sb, catalogo } from "../../../server/loja.js";
import { guarda } from "../../../server/admin.js";

const dia = d => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // AAAA-MM-DD
// início do dia em São Paulo (UTC-3) para uma data AAAA-MM-DD
const inicioSP = s => new Date(`${s}T00:00:00-03:00`);

export const onRequestGet = async ({ env, request }) => {
  const [, b] = await guarda(env, request); if (b) return b;
  const u = new URL(request.url);
  const hoje = dia(new Date());
  const per = u.searchParams.get("periodo") || "7";
  let de, ate;
  if (per === "hoje") { de = inicioSP(hoje); ate = new Date(de.getTime() + 864e5); }
  else if (per === "ontem") { ate = inicioSP(hoje); de = new Date(ate.getTime() - 864e5); }
  else { const n = Math.min(90, Math.max(1, parseInt(per, 10) || 7)); ate = new Date(inicioSP(hoje).getTime() + 864e5); de = new Date(ate.getTime() - n * 864e5); }

  let resumo = null, faltaTabela = false;
  try {
    resumo = await sb(env, "rpc/resumo_eventos", { method: "POST", body: JSON.stringify({ de: de.toISOString(), ate: ate.toISOString() }) });
  } catch (e) {
    if (/resumo_eventos|eventos|PGRST202|42P01|404/.test(String(e.message))) faltaTabela = true;
    else return erro("Não consegui carregar a análise.", 500);
  }

  // vendas do período (pedidos pagos), para conversão, ticket médio e vendidos por produto
  let pedidos = [];
  try {
    pedidos = await sb(env, `pedidos?select=id,criado_em,status,total,itens&criado_em=gte.${de.toISOString()}&criado_em=lt.${ate.toISOString()}&order=id.desc&limit=1000`, { method: "GET" });
  } catch {}
  const pagos = pedidos.filter(p => ["pago", "enviado", "entregue"].includes(p.status));
  const vendidos = {};
  for (const p of pagos) for (const i of p.itens || []) vendidos[i.nome] = (vendidos[i.nome] || 0) + Number(i.qtd || 0);
  const porDia = {};
  for (const p of pagos) { const k = dia(new Date(p.criado_em)); porDia[k] = porDia[k] || { pedidos: 0, faturamento: 0 }; porDia[k].pedidos++; porDia[k].faturamento += Number(p.total); }
  let ativos = [];
  try { ativos = (await catalogo(request, env)).produtos.filter(p => p.ativo !== false).map(p => p.nome); } catch {}

  return json({
    periodo: { de: dia(de), ate: dia(new Date(ate.getTime() - 1)), chave: per },
    faltaTabela, resumo: resumo || null,
    vendas: {
      pedidos: pagos.length, faturamento: Math.round(pagos.reduce((a, p) => a + Number(p.total), 0) * 100) / 100,
      pedidos_criados: pedidos.length, por_dia: porDia, vendidos,
    },
    produtos_ativos: ativos,
  });
};
