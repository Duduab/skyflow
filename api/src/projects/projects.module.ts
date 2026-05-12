import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanningImportAssetsController } from '../planning/planning-import-assets.controller';
import { PlanningUploadService } from '../planning/planning-upload.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, PlanningImportAssetsController],
  providers: [ProjectsService, PlanningUploadService],
  exports: [ProjectsService, PlanningUploadService],
})
export class ProjectsModule {}
