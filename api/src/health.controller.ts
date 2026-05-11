import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  ping() {
    return { ok: true, service: 'SkyFlow API' };
  }
}
