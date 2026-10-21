# Chat API (v2): личные сообщения тренер ↔ ученик

REST — `/api/v2/chat`, реалтайм — socket.io namespace **`/chat`** на том же HTTP-сервере.
Код: `v2/routes/chatRoom.routes.js`, `v2/controllers/chatRoom.controller.js`,
`v2/services/chat.service.js`, `sockets/chat.sockets.js`, модели `v2/models/ChatRoom.js`,
`v2/models/ChatMessage.js`. Тесты: `tests/integration/chat.test.js`.

> Старый `/api/v2/conversations` (модели `ConversationV2`/`MessageV2`) к этому модулю не относится.

## Кто с кем может переписываться

| Пара | Можно |
|---|---|
| тренер ↔ его ученик (`TrainingContract.coach` = профиль `Coach` тренера, `student` = ученик, статус не `cancelled`/`refunded`) | да |
| ADMIN ↔ любой пользователь | да |
| остальные | `403 CHAT_NOT_ALLOWED` при создании комнаты и при отправке сообщения |

Чужая комната неотличима от несуществующей: `404 ROOM_NOT_FOUND`.
Права проверяются при создании комнаты **и при каждой отправке** (REST и сокет): после отмены записи
история остаётся доступной участникам для чтения, но новое сообщение — `403 CHAT_NOT_ALLOWED`.

## Модели

**ChatRoom** (`chat_rooms`): `members` — ровно два пользователя; `context` —
`{ kind: 'direct' | 'puzzle' | 'homework' | 'book', refId?, title? }`; `lastMessage { text, sender, createdAt }`,
`lastMessageAt`. Уникальный `key` = отсортированные id участников + контекст: на пару — один общий диалог
(`direct`) и по одному диалогу на каждую задачу/домашку/книгу.

**ChatMessage** (`chat_messages`): `room`, `sender`, `text` (1–4000 символов), `readAt` (null — не прочитано
собеседником), `clientId?` (временный id отправителя), `createdAt`. Индексы: `{room, createdAt, _id}` (история),
`{room, readAt, sender}` (непрочитанные).

## REST

Все запросы — с `Authorization: Bearer <JWT>`. Ошибки — `{ msg, code, details? }`.

| Метод и путь | Тело / query | Ответ |
|---|---|---|
| `GET /chat/rooms` | — | `{ data: Room[] }`, свежие сверху |
| `POST /chat/rooms` | `{ userId, context? }` | `201` новая / `200` существующая: `{ data: Room }` |
| `GET /chat/rooms/:roomId/messages` | `?before=<messageId>&limit=1..100` (30) | `{ data: Message[] (по возрастанию), hasMore }` |
| `POST /chat/rooms/:roomId/messages` | `{ text, clientId? }` | `201 { data: Message }` |
| `POST /chat/rooms/:roomId/read` | — | `{ data: { updated, readAt } }` |
| `GET /chat/unread` | — | `{ data: { total, rooms: { [roomId]: n } } }` |
| `GET /chat/contacts` | — | `{ data: [{ _id, uuid, firstName, lastName, avatarUrl, relation: 'student' \| 'coach' }] }` |

`Room = { _id, context, interlocutor: { _id, uuid, firstName, lastName, avatarUrl }, lastMessage, lastMessageAt, unreadCount, createdAt }`
`Message = { _id, room, sender, text, createdAt, readAt, clientId? }`

Пагинация: первая страница — самые свежие `limit` сообщений; следующая (более старые) —
`before=<_id первого сообщения в списке>`. Повтор отправки с тем же `clientId` возвращает уже созданное
сообщение (без дубля).

Коды: `400 INVALID_ID | INVALID_CURSOR | CHAT_WITH_SELF`, `401 TOKEN_*`, `403 CHAT_NOT_ALLOWED`,
`404 ROOM_NOT_FOUND | USER_NOT_FOUND`, `422 VALIDATION_ERROR`.

## Socket.io

```js
const socket = io(`${API_ORIGIN}/chat`, { auth: { token: localStorage.getItem('token') } });
```

Аутентификация в handshake — та же проверка, что у REST (`v2/utils/accessToken.js`: подпись, срок,
версия сессии). Отказ приходит в `connect_error` с `err.data.code` = `TOKEN_REQUIRED | TOKEN_INVALID |
TOKEN_EXPIRED | SESSION_REVOKED | USER_NOT_FOUND`. Каждый сокет пользователя (все вкладки и устройства)
сидит в комнате `user:<id>`. CORS — те же источники, что у Express (`config/cors.js`).

Клиент → сервер, все с ack `{ ok: true, data } | { ok: false, error: { msg, code } }`:

| Событие | Payload | Действие |
|---|---|---|
| `message:send` | `{ roomId, text, clientId? }` | запись в БД, `message:new` обоим участникам; `data` — Message |
| `message:read` | `{ roomId }` | `readAt` у сообщений собеседника, `message:read` обоим |
| `typing` | `{ roomId, typing }` | `typing` собеседнику, без записи в БД |

Сервер → клиент:

| Событие | Payload |
|---|---|
| `message:new` | `{ roomId, message }` — и отправителю (эхо с `clientId`, для других вкладок) |
| `message:read` | `{ roomId, readerId, readAt }` |
| `typing` | `{ roomId, userId, typing }` |

Отправка через REST тоже рассылает `message:new` / `message:read`.
