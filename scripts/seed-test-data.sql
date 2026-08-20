-- Jeu de données destiné à faire réagir les règles de l'Advisor sur une instance de test.
-- À appliquer sur l'instance pg-full de docker-compose.test.yml :
--
--   docker exec -i <projet>-pg-full-1 psql -U postgres -d shop < scripts/seed-test-data.sql
--
-- Il crée volontairement des situations que les règles doivent détecter : lignes mortes,
-- index redondant, index inutilisé, clé étrangère non indexée, table jamais analysée,
-- chunks TimescaleDB anciens non compressés.

-- Garde-fou : le script commence par des DROP TABLE ... CASCADE et réinitialise les statistiques
-- de l'instance. Lancé par mégarde sur une base de production nommée « shop », il détruirait les
-- tables homonymes. On refuse donc de s'exécuter ailleurs que sur la base de test attendue.
DO $$
BEGIN
    IF current_database() <> 'shop' THEN
        RAISE EXCEPTION
            'seed-test-data.sql refuses to run on database "%": it drops tables and resets statistics. Expected "shop".',
            current_database();
    END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- --- Lignes mortes accumulées ------------------------------------------------
DROP TABLE IF EXISTS lignes_commande CASCADE;
DROP TABLE IF EXISTS commandes CASCADE;

CREATE TABLE commandes (
    id        bigserial PRIMARY KEY,
    client_id bigint NOT NULL,
    reference text NOT NULL,
    montant   numeric(12, 2) NOT NULL,
    statut    text NOT NULL,
    creee_le  timestamptz NOT NULL DEFAULT now()
);

-- Autovacuum désactivé sur la table : les lignes mortes s'accumulent durablement.
ALTER TABLE commandes SET (autovacuum_enabled = false);

INSERT INTO commandes (client_id, reference, montant, statut)
SELECT
    (random() * 5000)::bigint,
    'REF-' || g,
    (random() * 1000)::numeric(12, 2),
    (ARRAY['nouvelle', 'payee', 'expediee'])[1 + (random() * 2)::int]
FROM generate_series(1, 60000) AS g;

UPDATE commandes SET montant = montant + 1 WHERE id % 3 = 0;
DELETE FROM commandes WHERE id % 7 = 0;

-- --- Clé étrangère sans index ------------------------------------------------
CREATE TABLE lignes_commande (
    id          bigserial PRIMARY KEY,
    commande_id bigint NOT NULL REFERENCES commandes (id),
    article     text NOT NULL,
    quantite    int NOT NULL
);

INSERT INTO lignes_commande (commande_id, article, quantite)
SELECT c.id, 'article-' || (c.id % 50), 1 + (c.id % 5)
FROM commandes c
LIMIT 40000;

-- --- Index redondant et index inutilisé --------------------------------------
-- idx_commandes_client est le préfixe de idx_commandes_client_statut.
CREATE INDEX idx_commandes_client ON commandes (client_id);
CREATE INDEX idx_commandes_client_statut ON commandes (client_id, statut);

-- Index volumineux qu'aucune requête n'utilise.
CREATE INDEX idx_commandes_jamais_lu ON commandes (reference, statut, montant, creee_le, client_id);

-- --- Table jamais analysée ---------------------------------------------------
DROP TABLE IF EXISTS journal_acces;
CREATE TABLE journal_acces (
    id     bigserial PRIMARY KEY,
    chemin text,
    vu_le  timestamptz DEFAULT now()
);

INSERT INTO journal_acces (chemin)
SELECT '/page/' || g FROM generate_series(1, 20000) AS g;

-- --- Requêtes répétées pour alimenter pg_stat_statements ---------------------
SELECT pg_stat_statements_reset();

DO $$
BEGIN
    FOR i IN 1..40 LOOP
        PERFORM count(*)
        FROM commandes c
        JOIN lignes_commande l ON l.commande_id = c.id
        WHERE c.reference LIKE '%9%';
    END LOOP;
END $$;

-- --- Hypertable TimescaleDB avec des chunks anciens non compressés -----------
CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP TABLE IF EXISTS mesures;
CREATE TABLE mesures (
    releve_le timestamptz NOT NULL,
    capteur   text NOT NULL,
    valeur    double precision NOT NULL
);

SELECT create_hypertable('mesures', 'releve_le', chunk_time_interval => INTERVAL '1 day');

INSERT INTO mesures (releve_le, capteur, valeur)
SELECT
    now() - (g || ' hours')::interval,
    'capteur-' || (g % 10),
    random() * 100
FROM generate_series(1, 2000) AS g;

ANALYZE commandes;
ANALYZE lignes_commande;
ANALYZE mesures;
