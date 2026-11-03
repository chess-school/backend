-- Coach.showOnSite — тренер сам управляет показом своей карточки на публичном сайте клуба (default true).
ALTER TABLE "coaches" ADD COLUMN "showOnSite" BOOLEAN NOT NULL DEFAULT true;
