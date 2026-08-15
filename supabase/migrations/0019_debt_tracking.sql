-- 0019 — La dette se suit jusqu'au remboursement.
--
-- Quand une dépense en espèces dépasse ce que le tiroir contient, quelqu'un a
-- financé la différence — de sa poche, ou en empruntant. Le premier cas
-- (apport personnel) n'a rien à suivre : c'est de l'argent qui entre. Le
-- second EST une dette, et une dette non suivie est un accord verbal qui
-- s'oublie.
--
-- On ne crée pas un nouveau sous-système pour ça : `variances` fait déjà
-- exactement ce qu'il faut — une ligne ouverte tant que personne ne la solde,
-- visible au même tableau de bord, résolue par le même écran (Écarts). On lui
-- ajoute une source, `DEBT`, et le seul motif de résolution qui s'y applique,
-- `REMBOURSE`.
--
-- `record_expense` gagne trois paramètres optionnels pour porter l'écart :
-- absents, rien ne change par rapport à aujourd'hui. `resolve_variance` est
-- nouvelle — la résolution d'un écart n'avait encore aucune fonction serveur,
-- elle ne vivait que dans `state.variances`, perdue au premier rechargement
-- sur un autre appareil.

alter type public.variance_source add value if not exists 'DEBT';
alter type public.variance_resolution add value if not exists 'REMBOURSE';
