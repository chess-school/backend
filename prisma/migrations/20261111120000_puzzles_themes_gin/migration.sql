-- GIN-индекс по themes[] таблицы puzzles: ускоряет фильтр задач по теме на ~6М строк
-- (survival/rush, getRandom с theme). На проде уже создан вручную CONCURRENTLY — здесь
-- IF NOT EXISTS, чтобы миграция была идемпотентной и для восстановления с нуля.
CREATE INDEX IF NOT EXISTS "puzzles_themes_gin" ON "puzzles" USING GIN ("themes" array_ops);
