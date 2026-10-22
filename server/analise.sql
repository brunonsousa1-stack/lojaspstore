-- SP Store · Análise de visitas (cole tudo no Supabase: SQL Editor > New query > Run)
-- Cria a tabela de eventos do site e a função que monta o resumo para o painel.

create table if not exists public.eventos (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null,            -- visita | impressao | produto | carrinho | checkout | pedido
  visitante text,                -- id anônimo do navegador
  sessao text,                   -- id anônimo da visita (30 min)
  produto text, cor text, qtd int, valor numeric(10,2),
  origem text, dispositivo text, pagina text
);
create index if not exists eventos_em_idx on public.eventos (em);
create index if not exists eventos_tipo_em_idx on public.eventos (tipo, em);

-- Ninguém lê nem grava pelo navegador; só o servidor da loja (chave secreta).
alter table public.eventos enable row level security;
revoke all on public.eventos from anon, authenticated;

create or replace function public.resumo_eventos(de timestamptz, ate timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
with e as (
  select * from eventos where em >= de and em < ate
),
s as (  -- uma linha por visita (sessão)
  select sessao,
    (array_agg(origem order by em) filter (where tipo = 'visita'))[1] as origem,
    (array_agg(dispositivo order by em) filter (where tipo = 'visita'))[1] as dispositivo,
    bool_or(tipo = 'produto') as viu_produto,
    bool_or(tipo = 'carrinho') as carrinho,
    bool_or(tipo = 'checkout') as checkout,
    bool_or(tipo = 'pedido') as pedido,
    bool_or(tipo = 'visita') as visita
  from e where sessao is not null group by sessao
)
select jsonb_build_object(
  'totais', (select jsonb_build_object(
      'visitas', count(*) filter (where visita),
      'visitantes', (select count(distinct visitante) from e where tipo = 'visita'),
      'paginas', (select count(*) from e where tipo = 'visita'),
      'viu_produto', count(*) filter (where visita and viu_produto),
      'carrinho', count(*) filter (where visita and carrinho),
      'checkout', count(*) filter (where visita and checkout),
      'pedido', count(*) filter (where visita and pedido)
    ) from s),
  'dias', coalesce((select jsonb_agg(d order by d.dia) from (
      select to_char(em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia,
        count(distinct sessao) as visitas, count(distinct visitante) as visitantes
      from e where tipo = 'visita' group by 1) d), '[]'::jsonb),
  'pedidos_dia', coalesce((select jsonb_agg(d order by d.dia) from (
      select to_char(em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, count(distinct sessao) as pedidos
      from e where tipo = 'pedido' group by 1) d), '[]'::jsonb),
  'origens', coalesce((select jsonb_agg(o order by o.visitas desc) from (
      select coalesce(origem, 'direto') as origem, count(*) as visitas,
        count(*) filter (where carrinho) as carrinho, count(*) filter (where pedido) as pedidos
      from s where visita group by 1) o), '[]'::jsonb),
  'dispositivos', coalesce((select jsonb_agg(o order by o.visitas desc) from (
      select coalesce(dispositivo, 'outro') as dispositivo, count(*) as visitas, count(*) filter (where pedido) as pedidos
      from s where visita group by 1) o), '[]'::jsonb),
  'produtos', coalesce((select jsonb_agg(p order by p.cliques desc, p.impressoes desc) from (
      select produto,
        count(distinct sessao) filter (where tipo = 'impressao') as impressoes,
        count(distinct sessao) filter (where tipo = 'produto') as cliques,
        count(distinct sessao) filter (where tipo = 'carrinho') as carrinho,
        coalesce(sum(qtd) filter (where tipo = 'carrinho'), 0) as unidades_carrinho
      from e where produto is not null group by produto) p), '[]'::jsonb),
  'horas', coalesce((select jsonb_agg(h order by h.hora) from (
      select extract(hour from em at time zone 'America/Sao_Paulo')::int as hora, count(distinct sessao) as visitas
      from e where tipo = 'visita' group by 1) h), '[]'::jsonb)
);
$$;
revoke execute on function public.resumo_eventos(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.resumo_eventos(timestamptz, timestamptz) to service_role;
