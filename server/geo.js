// SP Store · distância (em linha reta) entre o CEP do cliente e a base, para o aviso interno "enviar com o carro".
// Coordenadas por CEP: AwesomeAPI → BrasilAPI → OpenStreetMap (Nominatim). Cada CEP é consultado uma vez e fica salvo no banco.
const digitos = t => String(t ?? "").replace(/\D/g, "");

export function km(a, b) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const valida = (lat, lng) => {
  lat = Number(lat); lng = Number(lng);
  // dentro do Brasil
  return lat < 6 && lat > -34 && lng < -28 && lng > -74 ? { lat, lng } : null;
};
async function buscarJson(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "SPStore/1.0 (lojaspstore.com.br)", ...headers }, cf: { cacheTtl: 86400 } });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function consultar(cep, endereco) {
  try {
    const d = await buscarJson(`https://cep.awesomeapi.com.br/json/${cep}`);
    const c = d && valida(d.lat, d.lng); if (c) return { ...c, fonte: "awesomeapi" };
  } catch {}
  try {
    const d = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    const co = d && d.location && d.location.coordinates;
    const c = co && valida(co.latitude, co.longitude); if (c) return { ...c, fonte: "brasilapi" };
  } catch {}
  try {
    const q = endereco && endereco.rua
      ? `street=${encodeURIComponent(`${endereco.numero || ""} ${endereco.rua}`.trim())}&city=${encodeURIComponent(endereco.cidade || "")}&state=${encodeURIComponent(endereco.uf || "")}&postalcode=${cep}`
      : `postalcode=${cep}`;
    const d = await buscarJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&${q}`);
    const c = Array.isArray(d) && d[0] && valida(d[0].lat, d[0].lon); if (c) return { ...c, fonte: "osm" };
  } catch {}
  return null;
}

// coordenadas de um CEP, com cache na tabela config (chave "geo:<cep>")
export async function coordCep(env, sb, cep, endereco) {
  cep = digitos(cep); if (cep.length !== 8) return null;
  const chave = `geo:${cep}`;
  try {
    const r = await sb(env, `config?chave=eq.${chave}&select=valor`, { method: "GET" });
    if (r && r[0] && r[0].valor && r[0].valor.lat) return r[0].valor;
  } catch {}
  const c = await consultar(cep, endereco);
  if (c) {
    try { await sb(env, "config?on_conflict=chave", { method: "POST", body: JSON.stringify({ chave, valor: c }), headers: { prefer: "resolution=merge-duplicates,return=minimal" } }); } catch {}
  }
  return c;
}

// { km, perto } — perto = dentro do raio do carro (loja.carro_raio_km, padrão 2)
export async function distanciaBase(env, sb, loja, endereco, cepBase) {
  if (!endereco || !endereco.cep) return null;
  const base = Number(loja.base_lat) && Number(loja.base_lng) ? { lat: Number(loja.base_lat), lng: Number(loja.base_lng) } : await coordCep(env, sb, cepBase || loja.base_cep || "08020360");
  const dest = await coordCep(env, sb, endereco.cep, endereco);
  if (!base || !dest) return null;
  const d = Math.round(km(base, dest) * 10) / 10;
  const raio = Number(loja.carro_raio_km) > 0 ? Number(loja.carro_raio_km) : 2;
  return { km: d, perto: d <= raio, raio };
}
