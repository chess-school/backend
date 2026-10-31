# Провижн PostgreSQL на боевом сервере (нужен sudo — делает Никита)

Сервер: 169.58.237.209. PG ставим локально рядом с node (как было бы с Mongo),
данные Mongo остаются в Atlas до катовера — strangler, обе БД живут параллельно.

## 1. Установка PostgreSQL 16

```bash
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-contrib-16
# если 16 нет в репозитории дистрибутива — подключить PGDG:
#   sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
#   wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
#   sudo apt-get update && sudo apt-get install -y postgresql-16
sudo systemctl enable --now postgresql
```

## 2. Создать БД и пользователя приложения

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE chess WITH LOGIN PASSWORD 'СМЕНИ_МЕНЯ_надёжный_пароль';
CREATE DATABASE chess_school OWNER chess;
-- отдельная БД под тесты (shadow для prisma migrate + интеграционные тесты)
CREATE DATABASE chess_school_shadow OWNER chess;
GRANT ALL PRIVILEGES ON DATABASE chess_school TO chess;
GRANT ALL PRIVILEGES ON DATABASE chess_school_shadow TO chess;
SQL
```

## 3. Доступ только локально (PG слушает localhost, наружу не торчит)

Проверить, что в `/etc/postgresql/16/main/postgresql.conf`:
```
listen_addresses = 'localhost'
```
`pg_hba.conf` — оставить `scram-sha-256` для local/127.0.0.1. Наружу порт 5432 НЕ открывать в ufw.

## 4. Строка подключения для бэкенда

После создания — добавить в `backend/.env` (НЕ коммитить):
```
DATABASE_URL="postgresql://chess:ПАРОЛЬ@localhost:5432/chess_school?schema=public"
SHADOW_DATABASE_URL="postgresql://chess:ПАРОЛЬ@localhost:5432/chess_school_shadow?schema=public"
```

## 5. Проверка

```bash
psql "postgresql://chess:ПАРОЛЬ@localhost:5432/chess_school" -c "SELECT version();"
```

Когда это готово — сообщи, я накачу первую Prisma-миграцию и начну strangler с первого домена.
