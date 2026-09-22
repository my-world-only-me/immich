import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "nsfw_detection" (
      "assetId" uuid NOT NULL,
      "score" real NOT NULL,
      "label" varchar(32)
    );
  `.execute(db);

  await sql`
    ALTER TABLE "nsfw_detection"
    ADD CONSTRAINT "nsfw_detection_pkey"
    PRIMARY KEY ("assetId");
  `.execute(db);

  await sql`
    ALTER TABLE "nsfw_detection"
    ADD CONSTRAINT "nsfw_detection_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "asset" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE;
  `.execute(db);

  // 方便按分数筛选（比如找 > 0.6 的）
  await sql`
    CREATE INDEX "nsfw_detection_score_idx"
    ON "nsfw_detection" ("score");
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "nsfw_detection";`.execute(db);
}
