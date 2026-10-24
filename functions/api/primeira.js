// Diz ao checkout se a conta logada ganha o desconto de primeira compra.
import { json, usuario, pronto, catalogo, pctPrimeira, primeiraCompra } from "../../server/loja.js";
export const onRequestGet = async ({ env, request }) => {
  try {
    if (!pronto(env)) return json({ primeira: false, pct: 0 });
    const { loja } = await catalogo(request, env);
    const pct = pctPrimeira(loja);
    const u = await usuario(env, request);
    if (!u || !pct) return json({ primeira: false, pct });
    return json({ primeira: await primeiraCompra(env, u), pct });
  } catch { return json({ primeira: false, pct: 0 }); }
};
