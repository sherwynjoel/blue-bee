import { Body, Controller, HttpCode, HttpStatus, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { confirmMediaSchema, presignMediaSchema, type ConfirmMediaDto, type PresignMediaDto } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { MediaService } from './media.service';

/**
 * The real presigned media path (Increment 10, §11.2/§14). No @Roles gate — authorization is the
 * ORDER-ownership check inside the service (a caller can only presign/confirm against an order/item
 * they can write), exactly the row-scoped pattern used elsewhere. Slash sub-paths (not `:action`
 * colons) per the Increment-9 path-to-regexp lesson.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
@UseInterceptors(IdempotencyInterceptor)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Presign a media upload → a short-lived PUT URL + object key (owner-scoped).' })
  presign(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(presignMediaSchema)) dto: PresignMediaDto) {
    return this.media.presign(p, dto);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Confirm a completed upload → HEAD-verify the object + create the Photo (idempotent).' })
  confirm(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(confirmMediaSchema)) dto: ConfirmMediaDto) {
    return this.media.confirm(p, dto);
  }
}
