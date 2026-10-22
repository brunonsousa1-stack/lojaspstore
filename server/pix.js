// Pix direto para a chave da loja (sem intermediário): gera o "Pix copia e cola" (BR Code)
// com valor exato e o número do pedido. A confirmação do recebimento é feita pelo dono no painel.
const limpa = (t, n) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .@+\-]/g, "").toUpperCase().trim().slice(0, n);
const campo = (id, v) => id + String(v.length).padStart(2, "0") + v;
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
export function chaveNormalizada(k) {
  k = String(k || "").trim();
  if (/^[^@\s]+@[^@\s]+$/.test(k)) return k.toLowerCase();                       // e-mail
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase(); // aleatória
  const d = k.replace(/\D/g, "");
  if (k.startsWith("+")) return "+" + d;                                           // celular: +5511...
  return d;                                                                         // CPF (11) ou CNPJ (14)
}
export function pixAtivo(loja) { return !!(loja && String(loja.pix_chave || "").trim()); }
export function brCode({ chave, nome, cidade, valor, txid, mensagem }) {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chaveNormalizada(chave)) + (mensagem ? campo("02", limpa(mensagem, 40)) : "");
  let s = campo("00", "01") + campo("26", conta) + campo("52", "0000") + campo("53", "986") +
    campo("54", Number(valor).toFixed(2)) + campo("58", "BR") + campo("59", limpa(nome, 25) || "LOJA") + campo("60", limpa(cidade, 15) || "SAO PAULO") +
    campo("62", campo("05", (String(txid || "").replace(/[^A-Za-z0-9]/g, "") || "***").slice(0, 25))) + "6304";
  return s + crc16(s);
}
