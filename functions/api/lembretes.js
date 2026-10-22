// Lembretes automáticos (chamado de hora em hora pelo GitHub Actions; pode ser chamado por qualquer um sem risco:
// cada e-mail sai uma única vez por pedido).
//  - Pedido feito e não pago há 1 a 48 horas → "Faltou só o pagamento"
//  - Pedido enviado há 7 a 30 dias, sem avaliação pedida → "O que você achou?"
import { json, pronto, sb, emails } from "../../server/loja.js";

const hrs = h => new Date(Date.now() - h * 3600e3).toISOString();

async function rodar(env, request) {
  if (!pronto(env)) return json({ ok: false, motivo: "loja não configurada" });
  const r = { pagamento: 0, avaliacao: 0 };
  try {
    const pend = await sb(env, `pedidos?select=*&status=eq.aguardando_pagamento&criado_em=lt.${hrs(1)}&criado_em=gt.${hrs(48)}&limit=30`, { method: "GET" });
    for (const p of pend) if (!(p.emails && (p.emails.lembrete_pagamento || p.emails.pix_informado))) { await emails(env, request, p, "lembrete_pagamento"); r.pagamento++; }
  } catch {}
  try {
    const env7 = await sb(env, `pedidos?select=*&status=in.(enviado,entregue)&atualizado_em=lt.${hrs(24 * 7)}&atualizado_em=gt.${hrs(24 * 30)}&limit=30`, { method: "GET" });
    for (const p of env7) if (!(p.emails && p.emails.pedir_avaliacao)) { await emails(env, request, p, "pedir_avaliacao"); r.avaliacao++; }
  } catch {}
  return json({ ok: true, enviados: r });
}
export const onRequestGet = ({ env, request }) => rodar(env, request);
export const onRequestPost = ({ env, request }) => rodar(env, request);
