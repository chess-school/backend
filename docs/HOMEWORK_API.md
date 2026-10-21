# API домашних заданий (`/api/v2/assignments`, `/api/v2/submissions`)

Тренер задаёт ДЗ к занятию в расписании → ученик сдаёт ответ (текст и/или скриншот) →
тренер принимает работу или отправляет на доработку. На каждом шаге создаётся уведомление:
`NEW_ASSIGNMENT`, `SUBMISSION_RECEIVED`, `SUBMISSION_REVIEWED`.
Формат ошибок — как в [STUDENTS_API.md](STUDENTS_API.md): `{ msg, code, details? }`.

## Кому адресовано ДЗ

Адресат берётся из занятия, к которому задано ДЗ:

| Занятие | Адресат ДЗ |
|---|---|
| индивидуальное | ученик |
| групповое | участники группы |
| для всего курса | ученики с активной записью на курс |

На одно занятие — одно ДЗ (повторная попытка — 409 `HOMEWORK_EXISTS`).

## Эндпоинты

| Метод и путь | Кто | Что делает |
|---|---|---|
| `POST /assignments` | COACH | `{ scheduleId, description, title?, dueDate? }` — задать ДЗ к своему занятию |
| `GET /assignments?scheduleId=` | COACH | свои ДЗ (например, ДЗ конкретного занятия) |
| `PATCH /assignments/:id` | COACH-автор, ADMIN | `{ title?, description?, dueDate? }`; `dueDate: null` снимает срок |
| `DELETE /assignments/:id` | COACH-автор, ADMIN | удалить ДЗ; если по нему уже сдавали — 409 `HAS_SUBMISSIONS` |
| `GET /assignments/my` | ученик | ДЗ, адресованные мне, с моей сдачей и данными занятия |
| `PUT /assignments/:id/submission` | ученик | сдать или пересдать (подробности ниже) |
| `GET /submissions/review?status=submitted` | COACH | сдачи по моим ДЗ; `status`: `submitted`, `needs_revision` или `approved` |
| `PATCH /submissions/:id/review` | COACH-автор, ADMIN | `{ status: 'approved' \| 'needs_revision', comment }` |
| `GET /submissions/:id/attachment` | ученик-автор, COACH-автор ДЗ, ADMIN | скриншот сдачи; всем остальным — 404 |

### Сдача ДЗ (`PUT /assignments/:id/submission`)

- Запрос — `multipart/form-data` с полями `contentText` и `file`. Файл — изображение PNG, JPEG, WebP или GIF до 5 МБ.
- Пересдавать можно, пока работа не принята; после принятия — 409 `ALREADY_APPROVED`.
- Если при пересдаче не прислать новый файл, сохраняется прежний скриншот.

### Проверка (`PATCH /submissions/:id/review`)

Для статуса `needs_revision` комментарий обязателен: тренер должен объяснить, что исправить.

## Ошибки

| Код | Когда |
|---|---|
| 403 | `NOT_YOUR_LESSON` — ДЗ к чужому занятию; `COACH_PROFILE_REQUIRED` — у тренера нет профиля |
| 404 | ДЗ или сдача не найдены, либо адресованы не вам |
| 409 | `HOMEWORK_EXISTS`, `HAS_SUBMISSIONS`, `ALREADY_APPROVED` |
| 413 | `FILE_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, `EMPTY_SUBMISSION`, `UNSUPPORTED_FILE_TYPE` |

## Примеры

```bash
# Тренер: задать ДЗ к занятию
curl -s -X POST "$API/assignments" -H "Authorization: Bearer $COACH" -H "Content-Type: application/json" \
  -d '{ "scheduleId": "66f…", "description": "Solve 5 Lucena positions", "dueDate": "2026-10-24" }'

# Ученик: сдать текст и скриншот
curl -s -X PUT "$API/assignments/66a…/submission" -H "Authorization: Bearer $STUDENT" \
  -F "contentText=1. Rd1 Ra2 2. Kf1" -F "file=@lucena.png;type=image/png"

# Тренер: отправить на доработку
curl -s -X PATCH "$API/submissions/66b…/review" -H "Authorization: Bearer $COACH" -H "Content-Type: application/json" \
  -d '{ "status": "needs_revision", "comment": "Build the bridge: 3. Rd4!" }'
```

## Хранение

- Скриншот хранится в документе `Submission` (`attachment.data`, `select: false`), как раньше в v1. Списки сдач байты файлов не загружают.
- При удалении занятия ДЗ к нему остаётся (по нему могли уже сдать работы), но ссылка на занятие снимается.
