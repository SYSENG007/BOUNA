-- =====================================================================
-- BUNA Operations — 0013 : ouvrir en LECTURE l'état du moteur d'alertes
--
-- `notification_cooldowns` porte RLS depuis 0001 et n'a jamais eu de
-- politique. 0004 l'avait documenté comme un choix : « aucun accès
-- client, par conception », le moteur écrivant depuis le serveur. Ce
-- choix tient toujours pour l'ÉCRITURE — il ne tient plus pour la
-- lecture.
--
-- Ce qui a changé : un cooldown est la seule explication d'une alerte
-- qui ne part pas. Tant que personne ne peut le lire, « pourquoi je n'ai
-- pas été prévenu que le lait était bas ? » n'a pas de réponse dans
-- l'application — il faut ouvrir la base. Une règle silencieuse qu'on ne
-- peut pas diagnostiquer finit par être désactivée, et l'alerte meurt
-- pour de bon.
--
-- L'écriture reste fermée, et ce n'est pas de la prudence de principe :
-- écrire un cooldown, c'est FAIRE TAIRE une alerte. Donner ce droit au
-- client donnerait à n'importe quel compte de l'organisation le moyen
-- d'éteindre une alerte de trésorerie ou de vol sans laisser de trace.
-- Le moteur, lui, écrit depuis le serveur et ne passe pas par RLS.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- L'ISOLATION PASSE PAR LA RÈGLE PARENTE
--
-- La table n'a pas d'`organization_id` : sa clé est (rule_id, scope_key).
-- L'appartenance se lit donc sur `notification_rules`, via la clé
-- étrangère. Le test sur `organization_id` y est écrit noir sur blanc
-- plutôt que laissé à la politique de lecture de `notification_rules` :
-- si celle-ci était un jour élargie, l'isolation des cooldowns ne
-- devrait pas se relâcher avec elle.
--
-- Aucun index à ajouter : `rule_id` est la colonne de tête de la clé
-- primaire, qui couvre déjà cette recherche.
--
-- La capacité retenue est `MANAGE_TEAM`, exactement celle qui garde
-- `notification_rules` en écriture depuis 0009 : qui règle les alertes
-- est qui a besoin de savoir pourquoi l'une d'elles se tait.
-- ---------------------------------------------------------------------

create policy notification_cooldowns_read on public.notification_cooldowns
  for select to authenticated
  using (
    (select public.has_capability('MANAGE_TEAM'))
    and exists (
      select 1
      from public.notification_rules r
      where r.id = notification_cooldowns.rule_id
        and r.organization_id = (select public.current_org_id())
    )
  );

-- Le commentaire de 0004 disait « aucun accès client ». Ce n'est plus
-- vrai : le laisser en l'état ferait mentir le schéma, et un schéma qui
-- ment coûte plus cher qu'un schéma muet.
comment on table public.notification_cooldowns is
  'Etat interne du moteur d''alertes : quand chaque regle a parle pour la derniere fois. Lecture ouverte a MANAGE_TEAM dans son organisation, pour diagnostiquer une alerte silencieuse. Aucune ecriture client, par conception : ecrire un cooldown fait taire une alerte. Ecrit uniquement par les fonctions serveur.';

commit;
