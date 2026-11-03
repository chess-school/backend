-- SiteSettings.theme — тема публичного сайта клуба, выбирает владелец ({ mode: 'light'|'dark' }).
ALTER TABLE "sitesettings" ADD COLUMN "theme" JSONB;
