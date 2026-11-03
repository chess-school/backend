-- SitePage: раздельное хранение черновика и опубликованного снимка.
-- Генерация/сохранение пишут в draft*, publish копирует их в опубликованные поля —
-- опубликованная страница остаётся на сайте, пока владелец не нажмёт Publish.
ALTER TABLE "sitepages" ADD COLUMN "draftTitle" TEXT;
ALTER TABLE "sitepages" ADD COLUMN "draftBlocks" JSONB;
ALTER TABLE "sitepages" ADD COLUMN "draftVersion" INTEGER;
ALTER TABLE "sitepages" ADD COLUMN "hasDraft" BOOLEAN NOT NULL DEFAULT false;
