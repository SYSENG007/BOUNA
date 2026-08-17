-- 0028 — La capacité « simuler une journée ».
--
-- Seule dans son fichier, pour la même raison que 0023 : `alter type ... add
-- value` s'exécute dans une transaction, mais la valeur ajoutée n'est
-- utilisable qu'une fois cette transaction VALIDÉE. Or `db-apply.sh` applique
-- chaque migration en une seule transaction. Ajouter la valeur et l'accorder
-- dans le même fichier échouerait sur « unsafe use of new value of enum type ».
--
-- 0029 s'en sert. La numérotation impose déjà l'ordre.
--
-- Pourquoi une capacité de plus et non `MANAGE_SETTINGS` : entrer en simulation
-- DÉPLACE la personne dans une autre organisation, ce qu'aucun réglage ne fait.
-- Confondre les deux, ce serait décider qu'on ne peut pas retirer l'un sans
-- retirer l'autre — deux décisions différentes, donc deux capacités.

alter type public.capability add value if not exists 'RUN_SIMULATION';
