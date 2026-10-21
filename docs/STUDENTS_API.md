# API модуля студентов (`/api/v2/students`)

Студент — это пользователь, записанный на курс. Запись = `TrainingContract`
(студент → курс → тренер → группа), к ней привязаны оплаты (`Payment`), занятия (`Schedule`)
и домашние задания (`Assignment` / `Submission`).

## Права

| Действие | ADMIN | COACH | Студент |
|---|---|---|---|
| Список студентов | все | только свои (по своим записям) | — |
| Карточка студента | любая | только свой студент, иначе 404 | только своя (`/students/me`) |
| Записать на курс | на любой курс | только на свои курсы | — |
| Изменить / удалить запись | любую | только свою | — |
| Статус `refunded` | да | нет | — |
| Изменить ФИО / телефон | да | нет | через `PUT /users/me` |

Тренеру нужен профиль `Coach` (`PUT /api/v2/coaches/me`), иначе 403 `COACH_PROFILE_REQUIRED`.

## Формат ошибок

```json
{ "msg": "Validation failed.", "code": "VALIDATION_ERROR",
  "details": [{ "field": "email", "message": "email must be a valid email address", "location": "body" }] }
```

| Код | Когда |
|---|---|
| 400 | битый id/uuid в URL (`INVALID_ID`), битый JSON (`MALFORMED_JSON`), пустое обновление |
| 401 | нет токена, неверный, истёк или сессия отозвана (`TOKEN_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `SESSION_REVOKED`) |
| 403 | нет роли (`FORBIDDEN_ROLE`), чужой курс (`NOT_COURSE_AUTHOR`), `ADMIN_ONLY` |
| 404 | студент, запись, курс, группа не найдены |
| 409 | `ALREADY_ENROLLED`, `HAS_PAYMENTS`, `CONCURRENT_UPDATE` |
| 422 | поля не прошли проверку (`VALIDATION_ERROR`), недопустимая смена статуса (`INVALID_STATUS_TRANSITION`), группа чужая или в архиве |
| 500 | `INTERNAL_ERROR` без подробностей (они пишутся только в лог сервера) |

## Правила валидации

- **email** — корректный адрес; пробелы обрезаются, регистр не важен.
- **ФИО** — 1–50 символов: буквы любого алфавита, пробел, дефис, апостроф («Анна-Мария», «O'Connor»).
- **Телефон** — международный формат E.164. `+38 (050) 123-45-67` сохраняется как `+380501234567`; `null` удаляет телефон.
- **Даты** — ISO 8601 (`2026-09-01` или `2026-09-01T18:00:00Z`); `endDate` не раньше `startDate`.
- **Статусы записи**: `pending_payment`, `pending_approval`, `active`, `completed`, `cancelled`, `refunded`.
  - При создании допустимы: `pending_payment`, `pending_approval`, `active`.
  - По умолчанию: платный курс — `pending_payment`, бесплатный — `active`.
- **Переходы статуса**:
  - `pending_payment` → `pending_approval` / `active` / `cancelled`
  - `pending_approval` → `active` / `cancelled`
  - `active` → `completed` / `cancelled` / `refunded`
  - `completed` → `active` / `refunded`
  - `cancelled` → `active` / `refunded`
  - `refunded` — конечный статус.
- **Лишние поля в теле запроса** — 422: так нельзя случайно записать чужие поля.

## Примеры

```bash
API=http://localhost:5000/api/v2
TOKEN=...   # токен из POST /api/v2/auth/login
```

### Список своих студентов

```bash
curl -s "$API/students?status=active&search=іван&page=1&limit=20" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [{
    "uuid": "0b6c…", "firstName": "Олег", "lastName": "Іваненко", "email": "oleg@school.io", "phone": "+380501234567",
    "enrollments": [{
      "_id": "66f…", "status": "active",
      "course": { "_id": "66e…", "title": "Openings A" },
      "group": { "_id": "66d…", "name": "A-group" },
      "progress": { "percentage": 40 },
      "payment": { "paid": true, "amountPaid": 5000 },
      "startDate": "2026-09-01T00:00:00.000Z", "endDate": null
    }],
    "lastEnrolledAt": "2026-10-20T19:00:00.000Z"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Фильтры: `status`, `courseId`, `groupId`, `coachId` (только ADMIN), `search` (имя, фамилия или email, без учёта регистра), `page`, `limit` (не больше 100).

### Карточка студента

```bash
curl -s "$API/students/0b6c…" -H "Authorization: Bearer $TOKEN"
curl -s "$API/students/me"    -H "Authorization: Bearer $STUDENT_TOKEN"   # своя карточка
```

Ответ: `data` с профилем, `enrollments`, `groups`, `upcomingLessons` (ближайшие 5) и `performance`:
`averageCourseProgress`, число сданных ДЗ по статусам `submissions` и процент принятых `approvalRate`.
Тренер видит только свои записи, группы, занятия и ДЗ.

### Записать студента на курс

```bash
curl -s -X POST "$API/students" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "email": "oleg@school.io", "courseId": "66e…", "groupId": "66d…", "startDate": "2026-09-01" }'
```

- Ответ `201`: `{ "msg": "Student enrolled.", "data": { …карточка… } }`.
- Вместо `email` можно передать `userUuid`.
- Пользователь должен быть зарегистрирован на сайте, иначе 404 `USER_NOT_FOUND`.
- ADMIN может указать `coachId`; по умолчанию запись получает первый автор курса.

Ошибка валидации (`422`):

```json
{ "msg": "Validation failed.", "code": "VALIDATION_ERROR",
  "details": [{ "field": "courseId", "message": "courseId is required", "location": "body" }] }
```

### Изменить запись (статус, группа, даты, прогресс)

```bash
curl -s -X PATCH "$API/students/0b6c…/enrollments/66f…" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{ "status": "completed", "progressPercentage": 100, "groupId": null }'
```

`groupId: null` убирает студента из группы: снимается и ссылка в записи, и членство в `Group.members`.

### Удалить запись

```bash
curl -s -X DELETE "$API/students/0b6c…/enrollments/66f…" -H "Authorization: Bearer $TOKEN" -i   # 204
```

- Вместе с записью удаляются её неуспешные платежи и будущие индивидуальные занятия, а членство в группе снимается.
- Оплаченную запись удалить нельзя: 409 `HAS_PAYMENTS`. Её переводят в `cancelled` или `refunded`.

### Изменить ФИО и телефон (ADMIN)

```bash
curl -s -X PATCH "$API/students/0b6c…" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{ "lastName": "Іваненко", "phone": "+38 (050) 123-45-67" }'
```
