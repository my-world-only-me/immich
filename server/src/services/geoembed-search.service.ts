import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnEvent, OnJob } from 'src/decorators';
import { AssetVisibility, DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { getCLIPModelInfo, isSmartSearchEnabled } from 'src/utils/misc';

@Injectable()
export class GeoEmbedSearchService extends BaseService{
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    await this.init(newConfig);
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    await this.init(newConfig, oldConfig);
  }

  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    try {
      getCLIPModelInfo(newConfig.machineLearning.geoclip.modelName);
    } catch {
      throw new Error(
        `Unknown GeoCLIP model: ${newConfig.machineLearning.geoclip.modelName}. Please check the model name for typos and confirm this is a supported model.`,
      );
    }
  }

  private async init(newConfig: SystemConfig, oldConfig?: SystemConfig) {
    if (!isSmartSearchEnabled(newConfig.machineLearning)) {
      return;
    }

    await this.databaseRepository.withLock(DatabaseLock.GEOCLIPDimSize, async () => {
      const { dimSize } = getCLIPModelInfo(newConfig.machineLearning.geoclip.modelName);
      const dbDimSize = await this.databaseRepository.getDimensionSize('geoembed_search');
      this.logger.verbose(`Current database GeoCLIP dimension size is ${dbDimSize}`);

      const modelChange =
        oldConfig && oldConfig.machineLearning.geoclip.modelName !== newConfig.machineLearning.geoclip.modelName;
      const dimSizeChange = dbDimSize !== dimSize;
      if (!modelChange && !dimSizeChange) {
        return;
      }

      if (dimSizeChange) {
        this.logger.log(
          `Geoembed dimension size of model ${newConfig.machineLearning.geoclip.modelName} is ${dimSize}, but database expects ${dbDimSize}.`,
        );
        this.logger.log(`Updating database Geoembed dimension size to ${dimSize}.`);
        await this.databaseRepository.setGeoembedDimensionSize(dimSize);
        this.logger.log(`Successfully updated database Geoembed dimension size from ${dbDimSize} to ${dimSize}.`);
      } else {
        await this.databaseRepository.deleteAllGeoEmbeddings();
      }

      // TODO: A job to reindex all assets should be scheduled, though user
      // confirmation should probably be requested before doing that.
    });
  }

  @OnJob({ name: JobName.GeoEmbedSearchQueueAll, queue: QueueName.GeoEmbedSearch })
  async handleQueueEncodeClip({ force }: JobOf<JobName.GeoEmbedSearchQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    console.log('GeoEmbedSearchService - handleQueueEncodeClip - force:', force);

    if (force) {
      const { dimSize } = getCLIPModelInfo(machineLearning.geoclip.modelName);
      // in addition to deleting embeddings, update the dimension size in case it failed earlier
      await this.databaseRepository.setGeoembedDimensionSize(dimSize);
    }

    let queue: JobItem[] = [];
    let queuedCount = 0;
    const assets = this.assetJobRepository.streamForEncodeGeoEmbed(force);
    for await (const asset of assets) {
      queue.push({ name: JobName.GeoEmbedSearch, data: { id: asset.id } });
      if (queue.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
      queuedCount++;
    }

    console.log(`GeoEmbedSearchService - handleQueueEncodeClip - queuedCount: ${queuedCount}`);
    await this.jobRepository.queueAll(queue);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.GeoEmbedSearch, queue: QueueName.GeoEmbedSearch })
  async handleEncodeClip({ id }: JobOf<JobName.GeoEmbedSearch>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForClipEncoding(id);
    if (!asset || asset.files.length !== 1) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }


    const embedding = await this.machineLearningRepository.encodeImage(asset.files[0].path, machineLearning.geoclip);

    if (this.databaseRepository.isBusy(DatabaseLock.GEOCLIPDimSize)) {
      this.logger.verbose(`Waiting for GEOCLIP dimension size to be updated`);
      await this.databaseRepository.wait(DatabaseLock.GEOCLIPDimSize);
    }

    const newConfig = await this.getConfig({ withCache: true });
    if (machineLearning.geoclip.modelName !== newConfig.machineLearning.geoclip.modelName) {
      // Skip the job if the model has changed since the embedding was generated.
      return JobStatus.Skipped;
    }

    await this.searchRepository.upsert_geoembed(asset.id, embedding);

    // inference streetclip embedding and store in geoembed search table

    return JobStatus.Success;
  }
}
