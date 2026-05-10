import { Module } from '@nestjs/common';
import { PlanningUploadService } from '../planning/planning-upload.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, PlanningUploadService],
  exports: [ProjectsService, PlanningUploadService],
})
export class ProjectsModule {}
