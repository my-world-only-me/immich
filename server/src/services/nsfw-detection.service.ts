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
export class NsfwDetectionService extends BaseService{
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
      getCLIPModelInfo(newConfig.machineLearning.nsfwDetection.modelName);
    } catch {
      throw new Error(
        `Unknown nsfw detection model: ${newConfig.machineLearning.nsfwDetection.modelName}. Please check the model name for typos and confirm this is a supported model.`,
      );
    }
  }

  private async init(newConfig: SystemConfig, oldConfig?: SystemConfig) {
    if (!isSmartSearchEnabled(newConfig.machineLearning)) {
      return;
    }
  }

  @OnJob({ name: JobName.NsfwDetectionQueueAll, queue: QueueName.NsfwDetection })
  async handleQueueNsfwDetection({ force }: JobOf<JobName.NsfwDetectionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force) {
      console.log('NsfwDetection clear all existing nsfw detection records');
      await this.databaseRepository.deleteAllNSFWDetection();
    }

    let queue: JobItem[] = [];
    const assets = this.assetJobRepository.streamForNsfwDetection(force);
    for await (const asset of assets) {
      queue.push({ name: JobName.NsfwDetection, data: { id: asset.id } });
      if (queue.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.NsfwDetection, queue: QueueName.NsfwDetection })
  async handleNsfwDetection({ id }: JobOf<JobName.NsfwDetection>): Promise<JobStatus> {
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

    const embedding = await this.machineLearningRepository.encodeImage(asset.files[0].path, machineLearning.nsfwDetection);

    try{
      let res = JSON.parse(embedding);
      // Math.log(res[0]);
      let sum = 0;
      for (let i = 0; i < res.length; i++) {
        res[i] = Math.exp(res[i]);
        sum += res[i];
      }
      const prob = res[1] / sum;
      const tag = prob > 0.5 ? 'nsfw' : 'normal';
      // console.log('NsfwDetection', id, res, prob);
      await this.searchRepository.upsert_nsfw(asset.id, prob, tag);
    }catch(e){
      console.log('NsfwDetection', id, e);
    }

    // if (this.databaseRepository.isBusy(DatabaseLock.CLIPDimSize)) {
    //   this.logger.verbose(`Waiting for CLIP dimension size to be updated`);
    //   await this.databaseRepository.wait(DatabaseLock.CLIPDimSize);
    // }

    // const newConfig = await this.getConfig({ withCache: true });
    // if (machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
    //   // Skip the job if the model has changed since the embedding was generated.
    //   return JobStatus.Skipped;
    // }

    // // await this.searchRepository.upsert(asset.id, embedding);

    // // inference streetclip embedding and store in geoembed search table

    return JobStatus.Success;
  }
}
