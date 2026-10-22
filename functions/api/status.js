// Diagnóstico da configuração da loja: só diz o que está ligado, nunca mostra chaves.
import { json, pronto, sb, catalogo, montarItens, configPublica } from "../../server/loja.js";
import { cotar, meAtivo } from "../../server/frete.js";
import { coordCep } from "../../server/geo.js";
export const onRequestGet = async ({ env, request }) => {
  const r = {
    supabase: !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_KEY),
    banco: false, emails: !!env.RESEND_API_KEY, loja_email: !!env.LOJA_EMAIL,
    mercado_pago: !!(env.MP_ACCESS_TOKEN && env.MP_PUBLIC_KEY), melhor_envio: meAtivo(env), frete_teste: null,
    pagamento_no_site: false, pix_direto: false,
  };
  try { const c = await configPublica(env, request); r.pagamento_no_site = c.pronto; r.pix_direto = c.pix; } catch {}
  if (r.supabase) { try { await sb(env, "pedidos?select=id&limit=1", { method: "GET" }); await sb(env, "config?select=chave&limit=1", { method: "GET" }); r.banco = true; } catch (e) { r.banco_erro = String(e.message).slice(0, 120); } }
  if (r.melhor_envio) {
    try {
      const { produtos, loja } = await catalogo(request, env);
      const p = produtos.find(x => x.ativo !== false);
      const itens = montarItens(produtos, [{ nome: p.nome, cor: (p.variantes && p.variantes[0] && p.variantes[0].nome) || "Padrão", qtd: 1 }]);
      const ops = await cotar(env, { cepOrigem: "", cepDestino: "01001000", itens, produtos, loja, subtotal: itens[0].preco });
      r.frete_teste = ops.map(o => `${o.nome} ${o.empresa}: R$ ${o.preco.toFixed(2)} (${o.prazo} dias)`).slice(0, 6);
    } catch (e) { r.frete_erro = String(e.message).slice(0, 160); }
  }
  if (r.banco) { try { const c = await coordCep(env, sb, "08020360"); r.localizacao_cep = c ? `ok (${c.fonte})` : "não encontrou"; } catch (e) { r.localizacao_cep = "erro"; } }
  return json(r);
};
