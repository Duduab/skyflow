import { Global, Module } from '@nestjs/common';
import { ProcessingJobsController } from './processing-jobs.controller';
import { ProcessingJobsService } from './processing-jobs.service';

/**
 * Global so any feature module can inject ProcessingJobsService (to enqueue
 * jobs and register handlers) without adding this module to every importer.
 */
@Global()
@Module({
  controllers: [ProcessingJobsController],
  providers: [ProcessingJobsService],
  exports: [ProcessingJobsService],
})
export class ProcessingJobsModule {}
