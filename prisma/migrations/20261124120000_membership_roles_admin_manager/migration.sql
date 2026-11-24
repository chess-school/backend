-- Добавляем клубные роли admin (co-owner) и manager (операционка без обучения)
-- к enum MembershipRole. Значения только добавляются — существующие строки не трогаем.
-- IF NOT EXISTS делает миграцию идемпотентной (безопасный повтор на проде).
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'admin' AFTER 'owner';
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'manager' AFTER 'trainer';
