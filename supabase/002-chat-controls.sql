-- Run ONCE after migration 001, in Sakireem Chat Manager's SQL Editor.
-- Creates accounting and server-only functions; does not enable live enforcement.
begin;
create table public.chat_sessions (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 mode text not null check (mode in ('public','preview')),
 period date not null,
 started_at timestamptz not null default now(),
 last_activity_at timestamptz not null default now(),
 reply_attempts integer not null default 0 check(reply_attempts between 0 and 30)
);
create index chat_sessions_customer_period on public.chat_sessions(customer_id,period,mode);
create table public.chat_requests (
 id uuid primary key,
 customer_id uuid not null references public.customers(id),
 session_id uuid not null references public.chat_sessions(id),
 fingerprint text not null,
 state text not null default 'pending' check(state in ('pending','succeeded','failed')),
 reply text,
 input_tokens bigint not null default 0 check(input_tokens>=0),
 output_tokens bigint not null default 0 check(output_tokens>=0),
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create index chat_requests_session on public.chat_requests(session_id);
create index chat_requests_customer on public.chat_requests(customer_id);
alter table public.chat_sessions enable row level security;
alter table public.chat_requests enable row level security;
revoke all on public.chat_sessions, public.chat_requests from public, anon, authenticated;
grant select on public.chat_sessions, public.chat_requests to authenticated;
create policy admins_read_chat_sessions on public.chat_sessions for select to authenticated
 using (exists(select 1 from public.platform_admins where user_id=(select auth.uid())));
create policy admins_read_chat_requests on public.chat_requests for select to authenticated
 using (exists(select 1 from public.platform_admins where user_id=(select auth.uid())));

create function public.chat_admit(p_bot text,p_mode text,p_session uuid,p_request uuid,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.customers%rowtype; s public.chat_sessions%rowtype; r public.chat_requests%rowtype;
 month_start date := date_trunc('month',now() at time zone 'UTC')::date;
 used bigint;
begin
 if p_mode is null or p_mode not in ('public','preview') or p_request is null
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
   return jsonb_build_object('allowed',false,'code','invalid_request');
 end if;
 -- Serializes admissions for a business, preventing quota overshoot.
 select * into c from public.customers where bot_slug=p_bot for update;
 if not found then return jsonb_build_object('allowed',false,'code','unknown_bot'); end if;
 if not c.chatbot_enabled then return jsonb_build_object('allowed',false,'code','bot_paused'); end if;
 if c.monthly_conversation_limit=0 then return jsonb_build_object('allowed',false,'code','monthly_limit'); end if;
 select * into r from public.chat_requests where id=p_request;
 if found then
   if r.customer_id<>c.id or r.fingerprint<>p_fingerprint then
     return jsonb_build_object('allowed',false,'code','invalid_request');
   end if;
   if r.state='succeeded' then
     return jsonb_build_object('allowed',true,'replay',true,'reply',r.reply,'conversation_id',r.session_id);
   end if;
   return jsonb_build_object('allowed',false,'code',case when r.state='pending' then 'request_pending' else 'request_failed' end,'conversation_id',r.session_id);
 end if;
 if p_session is not null then
   select * into s from public.chat_sessions where id=p_session;
   if found and (s.customer_id<>c.id or s.mode<>p_mode) then
     return jsonb_build_object('allowed',false,'code','invalid_session');
   end if;
 end if;
 if s.id is null or s.period<>month_start or s.last_activity_at <= now()-interval '30 minutes' then
   select count(*) into used from public.chat_sessions where customer_id=c.id and period=month_start and mode=p_mode;
   if used>=c.monthly_conversation_limit then return jsonb_build_object('allowed',false,'code','monthly_limit'); end if;
   insert into public.chat_sessions(customer_id,mode,period) values(c.id,p_mode,month_start) returning * into s;
 end if;
 if s.reply_attempts>=30 then return jsonb_build_object('allowed',false,'code','conversation_limit'); end if;
 update public.chat_sessions set reply_attempts=reply_attempts+1,last_activity_at=now() where id=s.id;
 insert into public.chat_requests(id,customer_id,session_id,fingerprint) values(p_request,c.id,s.id,p_fingerprint);
 return jsonb_build_object('allowed',true,'replay',false,'conversation_id',s.id);
end $$;

create function public.chat_finish(p_request uuid,p_state text,p_reply text,p_input_tokens bigint,p_output_tokens bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('succeeded','failed') then raise exception 'Invalid state'; end if;
 if p_state='succeeded' and (p_reply is null or length(p_reply)=0 or length(p_reply)>12000) then raise exception 'Invalid reply'; end if;
 update public.chat_requests set state=p_state,reply=case when p_state='succeeded' then p_reply else null end,
  input_tokens=greatest(coalesce(p_input_tokens,0),0),output_tokens=greatest(coalesce(p_output_tokens,0),0),completed_at=now()
 where id=p_request and state='pending';
 return found;
end $$;
revoke all on function public.chat_admit(text,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.chat_finish(uuid,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.chat_admit(text,text,uuid,uuid,text) to service_role;
grant execute on function public.chat_finish(uuid,text,text,bigint,bigint) to service_role;

create view public.customer_chat_usage with (security_invoker=true) as
select c.id as customer_id,
 date_trunc('month',now() at time zone 'UTC')::date as period,
 count(s.id) filter(where s.mode='public') as public_conversations,
 count(s.id) filter(where s.mode='preview') as preview_conversations,
 coalesce(sum(s.reply_attempts) filter(where s.mode='public'),0) as public_reply_attempts,
 coalesce(sum(s.reply_attempts) filter(where s.mode='preview'),0) as preview_reply_attempts
from public.customers c left join public.chat_sessions s on s.customer_id=c.id
 and s.period=date_trunc('month',now() at time zone 'UTC')::date
group by c.id;
revoke all on public.customer_chat_usage from public,anon,authenticated;
grant select on public.customer_chat_usage to authenticated;
comment on table public.chat_sessions is 'Accepted conversation starts, including starts whose AI request subsequently fails. UTC calendar months; test/public usage separate. Not unique visitors or confirmed leads.';
comment on table public.chat_requests is 'Request outcomes and temporary reply replay data. No user message text stored. Apply a retention policy before client production rollout.';
commit;
select * from public.customer_chat_usage;
