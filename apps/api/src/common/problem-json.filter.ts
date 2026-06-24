import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@blue-bee/shared';

/**
 * Global exception filter rendering RFC 7807 `application/problem+json` for every
 * error (PRD §11.1 "problem+json errors"). Uses the `ProblemDetails` shape from
 * @blue-bee/shared so the wire contract has a single source of truth.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        title = response;
      } else if (response && typeof response === 'object') {
        const body = response as Record<string, unknown>;
        title = (body.error as string) ?? exception.name;
        if (Array.isArray(body.message)) {
          errors = body.message as string[];
        } else if (typeof body.message === 'string') {
          detail = body.message;
        }
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
      this.logger.error(exception.stack ?? exception.message);
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title,
      status,
      instance: req.originalUrl ?? req.url,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
    };

    res.status(status).type('application/problem+json').json(problem);
  }
}
