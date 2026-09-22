import { AssetTable } from 'src/schema/tables/asset.table';
import { Column, ForeignKeyColumn, Index, Table } from 'src/sql-tools';

@Table({ name: 'nsfw_detection' })
@Index({ name: 'nsfw_detection_score_idx', columns: ['score'] })
export class NsfwDetectionTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true })
  assetId!: string;

  // NSFW 概率分数 (0–1)
  @Column({ type: 'double precision' })
  score!: number;

  // 分类标签（可选）：safe / nsfw / porn / hentai / neutral 等
  @Column({ type: 'character varying', length: 32, nullable: true })
  label?: string;

}
