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

## Домен 3: Identity (v2 'TestUser' / testusers) — ГОТОВ на уровне кода (не флипнут)
Канонические пользователи — **testusers (v2)** → единая таблица `users`. Legacy `models/User`
как сущность НЕ переносим (чистка отдельным проходом).
- [x] Модель `User` + миграция `add_user`. PK=ObjectId-строка. `roles` — реальный массив
  (`String[]`): фильтры `find({roles:'ADMIN'})`/`find({roles:role})`. Рейтинги Glicko-2 по 4
  контролям уплощены в **16 колонок** (не JSON), т.к. `gameManager` делает атомарный
  `$set`/`$inc` на `ratings.{speed}.*` — колонки + Prisma `increment` сохраняют атомарность.
  `puzzleRating`/`puzzleRatingGames` — скалярные колонки. rating/rd/vol — `Float`.
- [x] Шов `v2/repositories/user.repo.js` (флаг `USER_DB=mongo|pg`): инкапсулирует bcrypt
  (хеш при create/updatePassword, `comparePassword`), отдаёт публичный документ БЕЗ секретов
  (password/verificationToken/sessionTokenVersion) + auth-методы с секретами; наружу — прежняя
  форма Mongo-дока с вложенным `ratings`. ~25 методов (auth/сессия, профиль/роли, рейтинги).
- [x] Рероут ВСЕХ потребителей модели: auth.controller, accessToken, user.controller,
  admin.controller, schedule/classroom/group/coach.controller, puzzleBook.controller,
  student/coachRequest/coachApplication/chat.service, play/{matchmaking,challenge,gameManager}.
  Прямых `User.<метод>` вызовов не осталось.
- [x] ETL `scripts/migrate-users.js` (идемпотентно, пароль копируется как есть — уже bcrypt).
- [x] Тесты 122/122 (mongo-путь). PG-путь провалидирован смоуком (create/auth/comparePassword/
  roles/ratings/puzzle/profile/поиск — 23 проверки, с очисткой).
- [ ] Флип: `node scripts/migrate-users.js` → `USER_DB=pg` → `pm2 reload`. Требует команды Никиты.

### Два кросс-БД «ландмайна» identity — СНЯТЫ доменом Coaching (ниже)
~~1. student.service аггрегация $lookup→testusers~~ — переписана на прикладной джойн (userRepo).
~~2. coach.controller getCoaches populate('user')~~ — заменён на coachRepo.findCatalog (app-level join).

## Домен 4: Coaching (v2 Coach + TrainingContract) — ГОТОВ на уровне кода (не флипнут)
- [x] Схема + миграция `add_coaching`: модели Coach, TrainingContract (enum ContractStatus).
  `platformRating.average` — КОЛОНКА (по ней ORDER BY каталога); localized headline/bio/
  specializations, fideProfile, payoutInfo, packageSnapshot — JSON; priceAtPurchase→priceAmount/
  priceCurrency; progress→колонки. Уникальность (studentId,courseId).
- [x] Швы `coach.repo.js` + `trainingContract.repo.js` (флаг `COACHING_DB=mongo|pg`). КЛЮЧЕВОЕ:
  ВСЕ кросс-модельные джойны (coach→user, student→user, course, group, payment) делаются на
  уровне ПРИЛОЖЕНИЯ (userRepo/paymentRepo/coachRepo/Mongo Course,Group) вместо populate/$lookup —
  поэтому работают при любом сочетании флагов и снимают кросс-БД ландмайны.
- [x] Аггрегация listStudents (группировка по студенту + оплаты + поиск/сортировка/фасетная
  пагинация) ПЕРЕПИСАНА в trainingContract.repo.listStudentsForScope без $lookup (на users И payments)
  — это снимало флип не только Identity, но и **Payment**.
- [x] Рероут ВСЕХ потребителей Coach/TrainingContract (coach/admin/club/enrollment/schedule/group/
  course/payment controllers; student/homework/chat/coachApplication/coachRequest services).
  Прямых Coach.<метод>/TrainingContract.<метод> вызовов не осталось.
- [x] Попутно: добавлен `paymentRepo.deleteUnsucceededForContract` (чинит латентный ReferenceError —
  `Payment` использовался в student.service без импорта).
- [x] ETL `scripts/migrate-coaching.js` (coaches + trainingcontracts, идемпотентно).
- [x] Тесты 122/122 (mongo). PG-путь провалидирован смоуком (36 проверок, вкл. аггрегацию).
- [ ] Флип: `node scripts/migrate-coaching.js` → `COACHING_DB=pg` → `pm2 reload`. Требует команды Никиты.

## ⚠️ ОБЩАЯ находка: ландмайн-поверхность флипа ШИРЕ домена (sweep populate→app-join)
Мигрированные домены (User/Coach/TrainingContract) используются как Mongoose-РЕФЫ в ДРУГИХ,
ещё не мигрированных моделях. Их `.populate()` при флипе читает пустую Mongo-коллекцию. Перед
ЛЮБЫМ флипом эти чтения надо переписать на прикладной джойн через швы. Известные (НЕ исчерпывающе):
- `Group`/`Schedule` → `populate('coach' → 'user')` (club.controller:50/52, и др. по коду)
- `CoachRequest` → `populate('coach' → 'user')`, `populate('student')` (coachRequest.service)
- `Submission`/homework → `populate('student')` (homework.service) — ландмайн Identity
- любые другие `.populate()`/`$lookup`, резолвящиеся в users/coaches/trainingcontracts.
ДЕЙСТВИЕ: перед первым флипом прогнать `grep -rn "\.populate(\|\$lookup\|\.collection\.name" v2`
и перевести каждый такой резолв в users/coaches/trainingcontracts на app-level join. Это отдельный
кросс-срезовый шаг, НЕ привязанный к одному домену. Пока все флаги = mongo — всё консистентно.
