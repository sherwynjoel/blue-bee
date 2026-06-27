import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * The B2B self-serve invoice portal reads + PDF statement (Track A). Account-scoped invoice reads via
 * `scopedPrisma` (no schema change, write-free, audit-free). The invoice-level PAY endpoint reuses the
 * payments module's proven rail (it lives on the PaymentsController).
 */
@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
