# Миграция бэкенда MongoDB (Atlas) → PostgreSQL

Статус: В РАБОТЕ (ветка `migrate/postgres`). Начато 2026-10-30.

## Что и зачем
Переносим существующий Express-бэкенд с Mongoose/MongoDB Atlas на PostgreSQL.
Триггер — не нагрузка (Atlas тянет), а пивот в SaaS debiut: биллинг (деньги →
нужны транзакции, их сейчас НЕТ нигде), мульти-арендность и отчёты по клубам.

**НЕ делаем:** новый кодовый проект, переезд на NestJS. Это rewrite, который
удвоил бы риск. Меняем ТОЛЬКО слой хранения внутри текущего бэка.

## Решения (зафиксированы с Никитой)
- **ORM:** Prisma 7.10 (+ генерируемые типы).
- **Язык:** gradual TypeScript (`allowJs`), файлы конвертим в момент переноса их
  домена — не отдельным этапом. Express остаётся.
- **Стратегия:** Strangler — домен за доменом, обе БД работают параллельно
  (PG локально на сервере, Mongo в Atlas) до полного переезда.
- **Инстанс:** PostgreSQL 16 локально на 169.58.237.209 (см. PROVISION-PG.md, sudo у Никиты).

## 🔑 Ключевое инженерное решение: сохраняем ObjectId как PK
Чтобы обе БД могли ссылаться друг на друга во время strangler БЕЗ таблицы
ремаппинга id, первичный ключ в PG на время миграции = **строка Mongo `_id`
(hex ObjectId)**: `id TEXT PRIMARY KEY`. Тогда любая ссылка `userId` из Mongo-дока
указывает ровно на тот же `id` в PG. ETL = прямое копирование без перенумерации.
(Позже, когда всё в PG, можно опционально перейти на native uuid — но это не
обязательно и делается отдельно.)
Плюс к этому: код СЕЙЧАС не использует `populate`/`aggregate` (проверено: 0 и 0) —
связи и так читаются отдельными запросами, поэтому кросс-БД «джойн в приложении»
уже является текущим паттерном. Это сильно упрощает strangler.

## Паттерн переноса ОДНОГО домена (повторяем для каждого)
1. Описать таблицы домена в `prisma/schema.prisma`, сгенерить миграцию.
2. Написать репозиторий домена на Prisma (новый тонкий слой доступа).
3. Переписать контроллеры домена с Mongoose-вызовов на репозиторий; эти файлы
   конвертим в `.ts`.
4. ETL-скрипт: скопировать коллекцию(и) домена из Atlas в PG (сохраняя `_id`).
5. Флаг `DOMAIN_X_DB=pg|mongo` — переключаем чтение/запись домена на PG.
6. Прогнать тесты домена (на реальном PG, не memory-server), ручной smoke.
7. Деплой; наблюдаем; когда стабильно — удаляем Mongoose-модель домена.

## Порядок доменов (от низкого риска к горячему)
1. **Пилот — Notification** — простая модель, заметный объём (проверяем ETL
   на реальных данных), почти нет входящих ссылок → минимальный blast radius.
   На нём обкатываем весь конвейер и флаг-переключатель.
2. **Billing — Payment (+ TrainingContract?)** — ради чего всё и затевалось:
   сюда сразу приносим транзакции Prisma. Изолировано, низкий объём.
3. **Identity / Tenant — User, Role, Club, ClubMembership** — костяк, на который
   FK-ают почти все. После переноса включаем настоящие внешние ключи внутри PG.
4. **Coaching — Coach, CoachApplication, CoachRequest, Player, Group**.
5. **Content — Course, PuzzleBook, Puzzle, Position, SiteSettings**.
6. **Learning — Assignment, Submission, PuzzleAttempt, Homework, Schedule**.
7. **Play & Realtime (самое горячее, последним) — Game, LiveGame, SavedGames,
   ClassroomSession, ChatRoom/ChatMessage, Conversation/Message**. Тут сокеты и
   Redis-кластер — переносим осторожно, с отдельным smoke по онлайн-партиям.

## ⚠️ Важная находка: v1 И v2 работают ОДНОВРЕМЕННО
Инвентаризация + анализ импортов показали: приложение сейчас крутится на ДВУХ
наборах моделей сразу:
- **Legacy `/models`** (до-SaaS школа): `User`(в 26 файлах!), `Notification`(10),
  `Schedule`(8), `Game`(live-партия), `Player`, `Homework`, `Request`, `Role`,
  `SavedGame`. Коллекции `users`, `notifications`, `games`, `homeworks`…
  (`Puzzle` legacy — мёртвый закомментированный код.)
- **v2 `/v2/models`** (debiut SaaS): `TestUser`(коллекция `testusers`), `Club`,
  `Coach`, `ClubMembership`, `Course`, `PuzzleBook`, `LiveGame`, `Payment`,
  `Assignment`, `Submission`, `TrainingContract`, и т.д. v2-дубли разведены
  суффиксами (`PlayerV2`, `ScheduleV2`, `NotificationV2`, `ConversationV2`,
  `MessageV2`), коллекции `playerv2s`, `schedulev2s`, `notificationv2s`…

**РЕШЕНО (Никита):** канонические пользователи — **`testusers` (v2)**. Их и переносим
в единую таблицу `users` в PG. Legacy-коллекцию `users` НЕ тащим как отдельную
сущность; нужные legacy-контроллеры в домене identity переписываем на v2-модель.
Старый неиспользуемый код (legacy `/models` и завязанные на него куски) — **вычистить
ОТДЕЛЬНЫМ проходом** после миграции («чистка старого кода», не смешивать с переносом).

## Порядок доменов — уточнён под эту находку
Пилот (Notification) и Billing (Payment) трогают только v2 — на них обкатываем
конвейер, НЕ застревая в v1/v2 мешанине. Тяжёлый узел (identity-консолидация)
берём третьим, осознанно, после того как пайплайн доказан.

## Параллельно / долг
- Выкинуть мёртвую зависимость `@aws-sdk/client-dynamodb` (в коде не используется).
- Схлопнуть legacy `/models` ↔ `/v2/models` дубли (User, Game, Puzzle, Player,
  Notification, Schedule).
- Тесты: `mongodb-memory-server` → контейнерный/локальный PG (`chess_school_shadow`).

## Прогресс
- [x] Ветка `migrate/postgres`, Prisma 6 LTS установлена.
- [x] **PostgreSQL 16.15 поднят на проде** (кластер 16/main :5432, online). Создан
  пользователь `chess`, базы `chess_school` + `chess_school_shadow`. Строки
  подключения в `backend/.env` (DATABASE_URL/SHADOW_DATABASE_URL, не коммитятся).
- [x] **Домен Notification**: модель в schema.prisma, миграция
  `20261030230428_init_notification` применена, клиент сгенерён, smoke-тест
  (create/read/count/delete) зелёный. ← конвейер доказан end-to-end.
- [x] Notification: **репозиторий-шов** `v2/repositories/notification.repo.js`
  (mongo|pg по флагу `NOTIF_DB`, маппинг PG→форма Mongo-дока) + единый
  `v2/services/notify.js`. Read-контроллер переписан на репозиторий.
- [x] Notification: **все v2-эмиттеры** заведены через `notify()` (coachRequest,
  coachApplication, homework, lessonNotify) — домен flip-ready.
- [x] Notification: **недостающие чекпоинты добавлены** — GROUP_INVITE
  (group.controller addMemberToGroup), PAYMENT_SUCCESSFUL + CONTRACT_APPROVED +
  PAYMENT_FAILED (payment.controller webhook, идемпотентно). Работают уже сейчас
  (флаг=mongo).
- [x] Notification: **ETL** `scripts/migrate-notifications.js` написан и прогнан —
  28 записей Atlas→PG, повторный запуск идемпотентен (skipDuplicates).
- [x] pg-путь провалидирован end-to-end через репозиторий; тесты 122/122 зелёные.
- [ ] **Flip:** перед переключением ПЕРЕ-прогнать ETL (добрать новые за время
  работы), затем выставить `NOTIF_DB=pg` в прод-.env, `pm2 reload chess-cluster`,
  наблюдать. Односторонний катовер (dual-write нет).
- [ ] Отложенные типы (отдельные фичи): LESSON_REMINDER (нужен cron-джоб),
  NEW_MESSAGE (риск спама колокольчика — решить дизайн), SYSTEM_ANNOUNCEMENT
  (админ-рассылка).
- [ ] Легаси-путь уведомлений (`controllers/notifications.js`, старая модель
  `Notification`, коллекция `notifications`) — остаётся на Mongo, уедет в чистке legacy.
- [ ] Далее по порядку доменов (Payment → Identity → …).

### Как флипнуть Notification на PG (команды)
```
cd ~/chess-school/backend
node scripts/migrate-notifications.js      # добрать свежие (идемпотентно)
# в .env: NOTIF_DB=pg   (сейчас mongo)
pm2 reload chess-cluster
# проверить колокольчик в UI; откат — вернуть NOTIF_DB=mongo + reload
```
⚠️ Флип — боевой катовер, требует явной команды Никиты (авто-режим блокирует).

## Домен 2: Payment — ГОТОВ на уровне кода (не флипнут)
- [x] Схема + миграция `add_payment` (PK=ObjectId, enum'ы, 2 уникальных: contractId,
  gatewayTransactionId; Json metadata).
- [x] Шов `v2/repositories/payment.repo.js` (флаг `PAYMENT_DB=mongo|pg`):
  `upsertStripePayment` (идемпотентно — различает повтор txn и дубль по контракту),
  `findByContracts`, `existsSucceededForContract`, `findByClub`.
- [x] Рероут всех 4 мест: payment.controller (webhook), student.service (x2),
  club.controller (дашборд). Прямых обращений к модели Payment не осталось.
- [x] ETL `scripts/migrate-payments.js` прогнан (1 запись Atlas→PG). Идемпотентность
  upsert на PG проверена (new / повтор-txn / дубль-контракта). Тесты 122/122.
- [ ] Флип: `node scripts/migrate-payments.js` → `PAYMENT_DB=pg` → `pm2 reload`. Требует
  команды Никиты.
