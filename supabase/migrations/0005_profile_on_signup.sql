-- =====================================================================
-- BUNA Operations — création automatique du profil à l'inscription
--
-- Un compte Auth sans profil est un utilisateur sans organisation : il se
-- connecte, puis ne voit rien et ne comprend pas pourquoi. Le profil se crée
-- donc avec le compte, plutôt que par un rattachement manuel après coup.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_site uuid;
  v_role public.user_role;
  v_name text;
begin
  -- Pas d'identifiant en dur : on prend l'organisation existante.
  select id into v_org  from public.organizations order by created_at limit 1;
  select id into v_site from public.sites where organization_id = v_org order by created_at limit 1;

  if v_org is null then
    -- Base non amorcée : mieux vaut aucun profil qu'un profil orphelin.
    return new;
  end if;

  v_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::public.user_role,
    case split_part(new.email, '@', 1)
      when 'aicha'   then 'SELLER'
      when 'ibrahim' then 'PREPARER'
      when 'fatou'   then 'PROCUREMENT'
      when 'awa'     then 'MANAGER'
      when 'mamadou' then 'OWNER'
      when 'seydou'  then 'FINANCE'
      else 'SELLER'   -- par défaut, le rôle le moins privilégié
    end::public.user_role
  );

  v_name := coalesce(new.raw_user_meta_data ->> 'name', initcap(split_part(new.email, '@', 1)));

  insert into public.profiles (id, organization_id, site_id, name, role)
  values (new.id, v_org, v_site, v_name, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
