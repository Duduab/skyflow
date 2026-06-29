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
import { join } from 'path';
import { Public } from '../auth/public.decorator.js';
import { elevationMapStorageDir } from './elevation.service.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^page-\d+\.png$/i;

@Controller('elevation-maps')
export class ElevationAssetsController {
  @Public()
  @Get(':mapId/:filename')
  @Header('Cache-Control', 'public, max-age=3600')
  getImage(
    @Param('mapId') mapId: string,
    @Param('filename') filename: string,
  ): StreamableFile {
    if (!UUID_RE.test(mapId)) {
      throw new BadRequestException('Invalid map id');
    }
    if (!FILE_RE.test(filename)) {
      throw new BadRequestException('Invalid filename');
    }
    const full = join(elevationMapStorageDir(mapId), filename);
    if (!existsSync(full)) {
      throw new NotFoundException();
    }
    return new StreamableFile(createReadStream(full), {
      type: 'image/png',
      disposition: `inline; filename="${filename}"`,
    });
  }
}
