import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ProcessingJobsService } from './processing-jobs.service';

/** Client polling endpoint for background upload-processing jobs. */
@Controller('processing-jobs')
@UseGuards(RolesGuard)
export class ProcessingJobsController {
  constructor(private readonly jobs: ProcessingJobsService) {}

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':id')
  async getJob(@Param('id') id: string) {
    const job = await this.jobs.getJob(id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
