import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Writes to the immutable AuditLog (PRD §8.7 — every state-changing action is
 * attributed to a user). A DB trigger blocks UPDATE/DELETE, so this is append-only.
 * Accepts either the base client or a transaction client so it can run inside the
 * same atomic unit as the mutation it records.
 */
export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  at?: Date;
}

type Writer = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, writer?: Writer): Promise<void> {
    const db = writer ?? this.prisma;
    await db.auditLog.create({
      data: {
        orgId: entry.orgId,
        actorId: entry.actorId,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        before: entry.before,
        after: entry.after,
        ...(entry.at ? { at: entry.at } : {}),
        createdBy: entry.actorId,
      },
    });
  }
}
