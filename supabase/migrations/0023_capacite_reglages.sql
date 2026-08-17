-- 0023 — La capacité « choisir comment la maison suit ses coûts ».
--
-- Seule dans son fichier, et c'est obligatoire : `alter type ... add value`
-- s'exécute dans une transaction, mais la valeur ajoutée n'est utilisable
-- qu'une fois cette transaction VALIDÉE. Or `scripts/db-apply.sh` applique
-- chaque migration en une seule transaction (`--single-transaction`). Ajouter
-- la valeur et l'utiliser — ne serait-ce que pour l'accorder au propriétaire —
-- dans le même fichier échouerait sur « unsafe use of new value of enum type ».
--
-- D'où deux fichiers : celui-ci ajoute la valeur, 0024 s'en sert. Ils doivent
-- être appliqués dans cet ordre, ce que la numérotation impose déjà.

alter type public.capability add value if not exists 'MANAGE_SETTINGS';
