// SP Store · conta do cliente (login, cadastro, senha) usando o Supabase Auth
(function () {
  const CHAVE = "spstore_sessao";
  let CFG = null, sessao = null;
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) { return null; } };
  const gravar = s => { sessao = s; try { s ? localStorage.setItem(CHAVE, JSON.stringify(s)) : localStorage.removeItem(CHAVE); } catch (e) {} avisar(); };
  const ouvintes = [];
  const avisar = () => ouvintes.forEach(f => { try { f(sessao) } catch (e) {} });

  async function config() {
    if (CFG) return CFG;
    try { CFG = await fetch("/api/config", { cache: "no-store" }).then(r => r.ok ? r.json() : { pronto: false }); }
    catch (e) { CFG = { pronto: false }; }
    return CFG;
  }
  const TRADUZ = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Confirme seu e-mail antes de entrar. Procure a mensagem da SP Store na sua caixa de entrada (e no spam)."],
    [/user already registered|already been registered/i, "Este e-mail já tem conta. Use \"Entrar\" ou \"Esqueci a senha\"."],
    [/password should be at least|weak password|password is too weak/i, "A senha precisa ter pelo menos 8 caracteres, com letras e números."],
    [/rate limit|too many/i, "Muitas tentativas. Espere alguns minutos e tente de novo."],
    [/unable to validate email|invalid email|email address .* is invalid/i, "E-mail inválido."],
    [/same_password|should be different/i, "A nova senha precisa ser diferente da atual."],
  ];
  const traduz = m => { for (const [re, t] of TRADUZ) if (re.test(m)) return t; return m || "Algo deu errado. Tente de novo."; };

  async function auth(caminho, corpo, metodo = "POST", token) {
    const c = await config();
    if (!c.supabaseUrl) throw new Error("Contas ainda não disponíveis.");
    const h = { apikey: c.supabaseAnonKey, "content-type": "application/json" };
    if (token) h.authorization = "Bearer " + token;
    const r = await fetch(`${c.supabaseUrl}/auth/v1/${caminho}`, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(traduz(d.msg || d.error_description || d.message || d.error || ""));
    return d;
  }
  const deResposta = d => ({ access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (Number(d.expires_in) || 3600) * 1000, user: d.user || null });

  async function token() {
    if (!sessao) sessao = ler();
    if (!sessao) return null;
    if (Date.now() < sessao.expira - 60000) return sessao.access_token;
    try { const d = await auth("token?grant_type=refresh_token", { refresh_token: sessao.refresh_token }); gravar(deResposta(d)); return sessao.access_token; }
    catch (e) { gravar(null); return null; }
  }
  const volta = () => location.origin + "/conta.html";

  const Conta = {
    config,
    onChange(f) { ouvintes.push(f); },
    sessao() { if (!sessao) sessao = ler(); return sessao; },
    usuario() { const s = Conta.sessao(); return s && s.user; },
    token,
    async entrar(email, senha) { const d = await auth("token?grant_type=password", { email: email.trim(), password: senha }); gravar(deResposta(d)); return d.user; },
    async criar(email, senha, dados, voltarPara) {
      const url = "signup?redirect_to=" + encodeURIComponent(voltarPara || volta());
      const d = await auth(url, { email: email.trim(), password: senha, data: dados || {} });
      if (d.access_token) { gravar(deResposta(d)); return { entrou: true }; }
      // Supabase devolve um usuário "falso" sem identidades quando o e-mail já existe
      if (d.identities && d.identities.length === 0) throw new Error(traduz("already registered"));
      return { entrou: false, confirmar: true };
    },
    async esqueci(email) { await auth("recover?redirect_to=" + encodeURIComponent(volta()), { email: email.trim() }); },
    async novaSenha(senha) { const t = await token(); if (!t) throw new Error("Sessão expirada. Peça um novo link."); await auth("user", { password: senha }, "PUT", t); },
    async atualizarDados(dados) { const t = await token(); if (!t) return; const u = await auth("user", { data: dados }, "PUT", t); const s = Conta.sessao(); if (s) gravar({ ...s, user: u }); },
    async sair() { const t = sessao && sessao.access_token; gravar(null); if (t) auth("logout", null, "POST", t).catch(() => {}); },
    // Links do e-mail (confirmar conta / trocar senha) voltam com #access_token=...
    lerLinkDoEmail() {
      const h = new URLSearchParams(location.hash.replace(/^#/, ""));
      if (h.get("error_description")) { const m = h.get("error_description"); history.replaceState(null, "", location.pathname + location.search); return { erro: /expired|invalid/i.test(m) ? "Este link expirou. Peça um novo." : m }; }
      if (!h.get("access_token")) return null;
      const s = { access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expira: Date.now() + (Number(h.get("expires_in")) || 3600) * 1000, user: null };
      gravar(s);
      history.replaceState(null, "", location.pathname + location.search);
      return { tipo: h.get("type") || "" };
    },
    async carregarUsuario() { const t = await token(); if (!t) return null; try { const u = await auth("user", null, "GET", t); const s = Conta.sessao(); if (s) gravar({ ...s, user: u }); return u; } catch (e) { return null; } },
    async api(caminho, opcoes = {}) {
      const t = await token();
      const h = { "content-type": "application/json", ...(opcoes.headers || {}) };
      if (t) h.authorization = "Bearer " + t;
      const r = await fetch(caminho, { ...opcoes, headers: h, cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && t) { gravar(null); }
      if (!r.ok) { const e = new Error(d.erro || "Erro de conexão. Tente de novo."); e.status = r.status; e.dados = d; throw e; }
      return d;
    },
    senhaFraca(s) { return !(s && s.length >= 8 && /[a-zA-Z]/.test(s) && /\d/.test(s)); },
  };
  // link do e-mail aberto numa aba que já estava nesta página: recarrega para entrar
  window.addEventListener("hashchange", () => { if (/access_token=|error_description=/.test(location.hash)) location.reload(); });
  window.addEventListener("storage", e => { if (e.key === CHAVE) { sessao = ler(); avisar(); } });
  window.Conta = Conta;
})();
