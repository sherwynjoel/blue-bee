import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  captureProofOfDeliverySchema,
  presignPodMediaSchema,
  RoleType,
  stopActionSchema,
  stopExceptionSchema,
  type CaptureProofOfDeliveryDto,
  type PresignPodMediaDto,
  type StopActionDto,
  type StopExceptionDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { DriverService } from './driver.service';

/**
 * The driver app's duty-loop surface (Increment 9) — strictly DRIVER-self-scoped. Everything here
 * is authorized to the DRIVER role AND verified (in the service) to belong to the caller's own
 * driver profile, then delegated to the proven Increment-4 services (§5.4 state machine + shift
 * lifecycle). The ops endpoints (`/v1/routes`, `/v1/route-stops`, `/v1/shifts`) are untouched.
 */
@ApiTags('driver')
@ApiBearerAuth()
@Controller('driver')
@Roles(RoleType.DRIVER)
@UseInterceptors(IdempotencyInterceptor)
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  @Get('assignment')
  @ApiOperation({ summary: "The driver's current shift + assigned route + ordered stops (my route today)." })
  assignment(@CurrentUser() p: RequestPrincipal) {
    return this.driver.getAssignment(p);
  }

  @Post('shifts/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start MY shift (SCHEDULED → ACTIVE). GPS emits only while ACTIVE.' })
  startShift(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.startShift(p, id, dto);
  }

  @Post('shifts/:id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End MY shift (ACTIVE → ENDED). Stops GPS emission.' })
  endShift(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.endShift(p, id, dto);
  }

  // ── §5.4 stop transitions on MY route's stops ──

  @Post('stops/:id/depart')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Depart for a stop (→ EN_ROUTE); drives the order pickup leg.' })
  depart(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.stopAction(p, id, 'depart', dto);
  }

  @Post('stops/:id/arrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Arrive at a stop (→ ARRIVED).' })
  arrive(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.stopAction(p, id, 'arrive', dto);
  }

  @Post('stops/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start working a stop (→ IN_PROGRESS).' })
  startStop(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.stopAction(p, id, 'start', dto);
  }

  @Post('stops/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a stop (→ COMPLETED); drives the order PICKED_UP leg + custody.' })
  complete(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.driver.stopAction(p, id, 'complete', dto);
  }

  @Post('stops/:id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fail a stop (→ FAILED) — requires a reason code.' })
  fail(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopExceptionSchema)) dto: StopExceptionDto) {
    return this.driver.stopAction(p, id, 'fail', dto);
  }

  @Post('stops/:id/skip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip a stop (→ SKIPPED) — requires a reason code.' })
  skip(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopExceptionSchema)) dto: StopExceptionDto) {
    return this.driver.stopAction(p, id, 'skip', dto);
  }

  // ── proof of delivery (Increment 17): photo + signature + geo at a DELIVERY stop ──

  @Post('stops/:id/pod/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Presign a POD photo/signature upload for MY delivery stop (owner-scoped to the stop).' })
  presignPod(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(presignPodMediaSchema)) dto: PresignPodMediaDto) {
    return this.driver.presignPodMedia(p, id, dto);
  }

  @Post('stops/:id/proof-of-delivery')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Capture POD (confirmed photo(s) + signature + geo) for MY delivery stop. Idempotent on the stop.' })
  capturePod(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(captureProofOfDeliverySchema)) dto: CaptureProofOfDeliveryDto) {
    return this.driver.captureProofOfDelivery(p, id, dto);
  }

  @Get('stops/:id/proof-of-delivery')
  @ApiOperation({ summary: 'Read MY stop’s captured proof of delivery (signed reads).' })
  getPod(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.driver.getProofOfDelivery(p, id);
  }
}
