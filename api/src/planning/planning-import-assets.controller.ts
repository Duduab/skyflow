import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { extname, join } from 'path';
import { Public } from '../auth/public.decorator';
import {
  planningImportStorageDir,
  safePlanningImportFilename,
} from './planning-workbook-media';

function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('planning-imports')
export class PlanningImportAssetsController {
  @Public()
  @Get(':projectId/:filename')
  @Header('Cache-Control', 'public, max-age=3600')
  getImage(
    @Param('projectId') projectId: string,
    @Param('filename') filename: string,
  ): StreamableFile {
    if (!UUID_RE.test(projectId)) {
      throw new BadRequestException('Invalid project id');
    }
    const safe = safePlanningImportFilename(filename);
    if (!safe) {
      throw new BadRequestException('Invalid filename');
    }
    const dir = planningImportStorageDir(projectId);
    const full = join(dir, safe);
    if (!existsSync(full)) {
      throw new NotFoundException();
    }
    const stream = createReadStream(full);
    return new StreamableFile(stream, {
      type: contentTypeForExt(extname(safe)),
      disposition: `inline; filename="${safe}"`,
    });
  }
}
