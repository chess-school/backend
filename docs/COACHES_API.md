# Тренеры и заявки — `/api/v2/coaches`

Ошибки — в едином формате `{ msg, code, details? }`.

## Каталог

`GET /api/v2/coaches?page=1&limit=12&q=anna` — публично. Только верифицированные тренеры (`isVerified`),
по убыванию рейтинга на платформе. `q` — поиск по имени и фамилии (до 3 слов, регистр не важен).

```json
{ "data": [{ "_id": "<coachId>", "user": { "_id", "uuid", "firstName", "lastName", "avatarUrl" },
             "headline": "…", "bio": "…", "specializations": ["…"],
             "fideProfile": { "title": "IM", "rating": { "standard": 2450 }, "profileUrl": "…" },
             "platformRating": { "average": 4.8, "count": 12 } }],
  "pagination": { "currentPage": 1, "totalPages": 3, "totalCoaches": 30 } }
```

Тексты локализованы по `Accept-Language`. `limit` — от 1 до 50, иначе `422`.

Свой профиль тренера: `GET /api/v2/coaches/me` (404, если профиля ещё нет) и `PUT /api/v2/coaches/me`
с телом `{ headline, bio, specializations[], fideProfile, sourceLang }`. Тексты автоматически переводятся
на остальные языки.

## Заявки ученик → тренер

| Метод и путь | Кто | Что делает |
|---|---|---|
| `POST /coaches/:coachId/requests` | вошедший пользователь | Отправить заявку `{ experience: Beginner\|Intermediate\|Advanced, goals? (≤1000) }`, ответ `201` |
| `GET /coaches/requests/sent` | вошедший пользователь | Мои заявки, от новых к старым |
| `GET /coaches/me/requests?status=` | COACH, ADMIN | Заявки мне: рассматриваемые первыми. ADMIN видит заявки всех тренеров |
| `PATCH /coaches/me/requests/:requestId` | COACH, ADMIN | `{ status: 'approved', courseId }` или `{ status: 'rejected' }` |

**Одобрение** записывает ученика на выбранный курс тренера (создаётся `TrainingContract`, как в модуле
учеников). После этого ученик появляется в «Моих учениках» и может писать тренеру в чат.

Тренер и ученик получают уведомления: `COACH_REQUEST` и `COACH_REQUEST_DECIDED`.

### Коды ошибок

| Код | Статус | Когда |
|---|---|---|
| `COACH_NOT_FOUND` | 404 | Тренер не найден или не верифицирован |
| `SELF_REQUEST` | 422 | Заявка самому себе |
| `REQUEST_PENDING` | 409 | Заявка этому тренеру уже ждёт ответа (одна на пару) |
| `ALREADY_STUDENT` | 409 | Пользователь уже записан к этому тренеру |
| `REQUEST_NOT_FOUND` | 404 | Заявка чужого тренера или не существует |
| `REQUEST_ALREADY_DECIDED` | 409 | Повторное или параллельное решение |
| `VALIDATION_ERROR` | 422 | Например, одобрение без `courseId` |
| `ALREADY_ENROLLED`, `NOT_COURSE_AUTHOR` | 409, 403 | Ошибки записи на курс (из модуля учеников) |

После отказа можно отправить новую заявку.

Старые маршруты v1 `/api/trainer/request(s)` не изменены. Фронтенд ими больше не пользуется.
