import { AssetTable } from 'src/schema/tables/asset.table.js'
import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools'

@Table({ name: 'geoembed_search' })
@Index({
  name: 'clip_index',
  using: 'hnsw',
  expression: `embedding vector_cosine_ops`,
  with: `ef_construction = 300, m = 16`,
  synchronize: false,
})
export class GeoembedSearchTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'vector', length: 768, storage: 'external', synchronize: false })
  embedding!: string;
}
