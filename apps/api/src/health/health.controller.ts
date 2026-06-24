import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { healthStatusSchema, type HealthStatus } from '@blue-bee/shared';
import { HealthService } from './health.service';
import { Public } from '../auth/rbac/decorators';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness/readiness — live DB + Redis round-trip (PRD §12.3).' })
  @ApiResponse({ status: 200, description: 'All dependencies up.' })
  @ApiResponse({ status: 503, description: 'One or more dependencies down.' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    const checks = await this.health.runChecks();
    const ok = checks.every((c) => c.status === 'up');
    const body: HealthStatus = {
      status: ok ? 'ok' : 'error',
      service: 'blue-bee-api',
      timestamp: new Date().toISOString(),
      checks,
    };
    res.status(ok ? 200 : 503).type('application/json');
    // Validate our own response against the shared contract — fail loud if it drifts.
    return healthStatusSchema.parse(body);
  }
}
