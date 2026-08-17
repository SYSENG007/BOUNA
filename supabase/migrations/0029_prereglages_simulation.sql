-- =====================================================================
-- 0029 — Le préréglage propose « simuler une journée ».
--
-- SEUL DANS SON FICHIER, et pas par goût du découpage : `prereglages.test.ts`
-- relit ce SQL en prenant tout ce qui suit `insert into
-- post_capability_preset` jusqu'à la fin du fichier, puis y cherche les paires
-- `('POSTE','CAPACITE')`. Toute autre instruction placée après le seed et
-- contenant deux littéraux majuscules côte à côte — `p.post in
-- ('OWNER','MANAGER')`, `i.kind in ('RAW_MATERIAL','PACKAGING')` — est alors
-- lue comme une ligne de préréglage, et le test échoue sur des capacités qui
-- n'existent pas.
--
-- Le test a raison de rester grossier : il lit du SQL versionné sans le
-- comprendre, et c'est précisément ce qui le rend fiable. C'est au fichier de
-- ne contenir que ce qu'il annonce. 0030 fait le reste.
--
-- Régénéré EN ENTIER depuis `POST_PRESET`, jamais complété : voir 0027. Sans le
-- `delete`, une capacité RETIRÉE d'un préréglage resterait accordée aux comptes
-- suivants.
-- =====================================================================

delete from public.post_capability_preset;
insert into public.post_capability_preset (post, capability) values
  -- OWNER — 27 capacités
  ('OWNER','SELL'),
  ('OWNER','VOID_SALE'),
  ('OWNER','MANAGE_CASH_SESSION'),
  ('OWNER','VIEW_ALL_SALES'),
  ('OWNER','VIEW_STOCK'),
  ('OWNER','RECORD_WASTE'),
  ('OWNER','TRANSFER_STOCK'),
  ('OWNER','COUNT_INVENTORY'),
  ('OWNER','RESOLVE_VARIANCE'),
  ('OWNER','PRODUCE'),
  ('OWNER','EDIT_RECIPE'),
  ('OWNER','REQUEST_PURCHASE'),
  ('OWNER','APPROVE_PURCHASE'),
  ('OWNER','PLACE_ORDER'),
  ('OWNER','RECEIVE_GOODS'),
  ('OWNER','MANAGE_SUPPLIERS'),
  ('OWNER','RECORD_EXPENSE'),
  ('OWNER','VIEW_FINANCES'),
  ('OWNER','CLOSE_DAY'),
  ('OWNER','REOPEN_DAY'),
  ('OWNER','VIEW_DASHBOARD'),
  ('OWNER','MANAGE_CATALOG'),
  ('OWNER','MANAGE_LOCATIONS'),
  ('OWNER','MANAGE_TEAM'),
  ('OWNER','VIEW_AUDIT_LOG'),
  ('OWNER','MANAGE_SETTINGS'),
  ('OWNER','RUN_SIMULATION'),
  -- MANAGER — 26 capacités
  ('MANAGER','SELL'),
  ('MANAGER','VIEW_STOCK'),
  ('MANAGER','MANAGE_CASH_SESSION'),
  ('MANAGER','RECORD_WASTE'),
  ('MANAGER','PRODUCE'),
  ('MANAGER','TRANSFER_STOCK'),
  ('MANAGER','COUNT_INVENTORY'),
  ('MANAGER','REQUEST_PURCHASE'),
  ('MANAGER','PLACE_ORDER'),
  ('MANAGER','RECEIVE_GOODS'),
  ('MANAGER','MANAGE_SUPPLIERS'),
  ('MANAGER','RECORD_EXPENSE'),
  ('MANAGER','VOID_SALE'),
  ('MANAGER','VIEW_ALL_SALES'),
  ('MANAGER','RESOLVE_VARIANCE'),
  ('MANAGER','EDIT_RECIPE'),
  ('MANAGER','APPROVE_PURCHASE'),
  ('MANAGER','VIEW_FINANCES'),
  ('MANAGER','CLOSE_DAY'),
  ('MANAGER','VIEW_DASHBOARD'),
  ('MANAGER','MANAGE_CATALOG'),
  ('MANAGER','MANAGE_LOCATIONS'),
  ('MANAGER','MANAGE_TEAM'),
  ('MANAGER','VIEW_AUDIT_LOG'),
  ('MANAGER','MANAGE_SETTINGS'),
  ('MANAGER','RUN_SIMULATION'),
  -- FINANCE — 8 capacités
  ('FINANCE','RECORD_EXPENSE'),
  ('FINANCE','VIEW_FINANCES'),
  ('FINANCE','VIEW_AUDIT_LOG'),
  ('FINANCE','VIEW_STOCK'),
  ('FINANCE','VIEW_DASHBOARD'),
  ('FINANCE','VIEW_ALL_SALES'),
  ('FINANCE','MANAGE_SUPPLIERS'),
  ('FINANCE','CLOSE_DAY'),
  -- PROCUREMENT — 6 capacités
  ('PROCUREMENT','REQUEST_PURCHASE'),
  ('PROCUREMENT','PLACE_ORDER'),
  ('PROCUREMENT','RECEIVE_GOODS'),
  ('PROCUREMENT','MANAGE_SUPPLIERS'),
  ('PROCUREMENT','VIEW_STOCK'),
  ('PROCUREMENT','RECORD_EXPENSE'),
  -- PREPARER — 5 capacités
  ('PREPARER','PRODUCE'),
  ('PREPARER','VIEW_STOCK'),
  ('PREPARER','RECORD_WASTE'),
  ('PREPARER','TRANSFER_STOCK'),
  ('PREPARER','COUNT_INVENTORY'),
  -- SELLER — 4 capacités
  ('SELLER','SELL'),
  ('SELLER','VIEW_STOCK'),
  ('SELLER','MANAGE_CASH_SESSION'),
  ('SELLER','RECORD_WASTE');
