-- Die App verbindet sich bewusst NICHT als Superuser: Superuser umgehen Row-Level Security.
CREATE ROLE companygpt LOGIN PASSWORD 'companygpt' NOSUPERUSER;
CREATE DATABASE companygpt OWNER companygpt;
\connect companygpt
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
