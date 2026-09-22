import { Kysely, sql } from 'kysely';
import { getVectorExtension } from 'src/repositories/database.repository';
import { vectorIndexQuery } from 'src/utils/database';

export async function up(db: Kysely<any>): Promise<void> {
  const vectorExtension = await getVectorExtension(db);
  await sql`ALTER TABLE "asset_exif" ADD "altitude" double precision;`.execute(db);
  await sql`ALTER TABLE "asset_exif" ADD "direction" double precision;`.execute(db);
  await sql`ALTER TABLE "asset_exif" ADD "yaw" double precision;`.execute(db);
  await sql`ALTER TABLE "asset_exif" ADD "pitch" double precision;`.execute(db);
  await sql`ALTER TABLE "asset_exif" ADD "roll" double precision;`.execute(db);
  await sql`CREATE TABLE "geoembed_search" ("assetId" uuid NOT NULL, "embedding" vector(768) NOT NULL);`.execute(db);
  await sql`ALTER TABLE "geoembed_search" ALTER COLUMN "embedding" SET STORAGE EXTERNAL;`.execute(db);
  await sql`ALTER TABLE "geoembed_search" ADD CONSTRAINT "geoembed_search_pkey" PRIMARY KEY ("assetId");`.execute(db);
  await sql`ALTER TABLE "geoembed_search" ADD CONSTRAINT "geoembed_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;`.execute(db);
  await sql.raw(vectorIndexQuery({ vectorExtension, table: 'geoembed_search', indexName: 'clip_index' })).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_exif" DROP COLUMN "altitude";`.execute(db);
  await sql`ALTER TABLE "asset_exif" DROP COLUMN "direction";`.execute(db);
  await sql`ALTER TABLE "asset_exif" DROP COLUMN "yaw";`.execute(db);
  await sql`ALTER TABLE "asset_exif" DROP COLUMN "pitch";`.execute(db);
  await sql`ALTER TABLE "asset_exif" DROP COLUMN "roll";`.execute(db);
  await sql`DROP TABLE "geoembed_search";`.execute(db);
}