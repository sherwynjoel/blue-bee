import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { decimalMoney } from '../orders/money';
import { parseStoredBreakdown } from '../cost-centers/cost-center-split';
import type { InvoiceForStatement } from './invoices.service';

/** `$1,234.50 CAD` from a Decimal/string amount (presentation only — never re-derives the amount). */
function money(amount: unknown, currency = 'CAD'): string {
  const s = decimalMoney(amount as never);
  const [intPart, frac] = s.split('.');
  const grouped = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}.${frac ?? '00'} ${currency}`;
}

function shortDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const BRAND = '#2563EB';
const INK = '#0B1524';
const MUTED = '#5B6B82';
const HAIRLINE = '#E2E8F0';

/**
 * Server-side, pure-JS PDF invoice statement (Track A — the B2B portal "Download PDF"). Uses `pdfkit`
 * (NO headless Chrome) to stream REAL bytes: the account + billing-terms header, the line items, the
 * cost-centre split (when present), totals + HST, and the paid/due status. The amounts come verbatim
 * from the stored invoice (cents-exact) — the PDF and the on-screen view reconcile to the same totals.
 */
@Injectable()
export class InvoicePdfService {
  async buildStatement(inv: InvoiceForStatement): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${inv.number ?? inv.id}`, Author: 'Blue Bee' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const currency = inv.currency;

    // ── Header: brand + statement title + status ──
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(22).text('Blue Bee', left, 50);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Commercial laundry & specialty cleaning — Greater Toronto Area', left, 76);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('Invoice statement', left, 76, { width, align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`Status: ${inv.status}`, left, 98, { width, align: 'right' });

    doc.moveTo(left, 118).lineTo(right, 118).strokeColor(HAIRLINE).lineWidth(1).stroke();

    // ── Account + invoice meta (two columns) ──
    let y = 134;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('BILLED TO', left, y);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(inv.account.name, left, y + 13, { width: width / 2 - 10 });
    const terms = inv.account.billingMode === 'BATCH_PERIODIC' ? `Periodic billing · Net ${inv.account.billingNetDays} days` : 'Per-order billing';
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(terms, left, y + 31, { width: width / 2 - 10 });

    const metaX = left + width / 2;
    const metaW = width / 2;
    const meta: Array<[string, string]> = [
      ['Invoice #', inv.number ?? inv.id.slice(0, 8).toUpperCase()],
      ['Issued', shortDate(inv.issuedAt)],
      ['Due', shortDate(inv.dueAt)],
    ];
    if (inv.paidAt) meta.push(['Paid', shortDate(inv.paidAt)]);
    if (inv.period) meta.push(['Period', inv.period]);
    let my = y;
    for (const [k, v] of meta) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, metaX, my, { width: metaW * 0.4 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(v, metaX + metaW * 0.4, my, { width: metaW * 0.6, align: 'right' });
      my += 15;
    }

    y = Math.max(y + 52, my) + 14;

    // ── Line items ──
    y = this.sectionHeading(doc, 'Line items', left, right, y);
    const descX = left;
    const qtyX = right - 200;
    const amtRight = right;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('DESCRIPTION', descX, y);
    doc.text('QTY', qtyX, y, { width: 60, align: 'right' });
    doc.text('AMOUNT', amtRight - 110, y, { width: 110, align: 'right' });
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9.5);
    for (const l of inv.invoiceLines) {
      const h = doc.heightOfString(l.description, { width: qtyX - descX - 12 });
      doc.fillColor(INK).text(l.description, descX, y, { width: qtyX - descX - 12 });
      doc.fillColor(INK).text(String(l.quantity), qtyX, y, { width: 60, align: 'right' });
      doc.fillColor(INK).text(money(l.amount, currency), amtRight - 110, y, { width: 110, align: 'right' });
      y += Math.max(h, 12) + 6;
      if (y > doc.page.height - 160) { doc.addPage(); y = 60; }
    }

    // ── Totals ──
    y += 4;
    doc.moveTo(qtyX, y).lineTo(right, y).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
    y += 8;
    y = this.totalRow(doc, 'Subtotal', money(inv.subtotal, currency), qtyX, right, y, false);
    y = this.totalRow(doc, 'HST (13%)', money(inv.tax, currency), qtyX, right, y, false);
    y = this.totalRow(doc, 'Total', money(inv.total, currency), qtyX, right, y, true);

    // ── Cost-centre split (only when the invoice carries one) ──
    const breakdown = parseStoredBreakdown(inv.costCenterBreakdown);
    if (breakdown.length > 0) {
      y += 18;
      if (y > doc.page.height - 200) { doc.addPage(); y = 60; }
      y = this.sectionHeading(doc, 'Cost-centre split', left, right, y);
      const cTotalR = right;
      const cTaxR = right - 110;
      const cSubR = right - 220;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
      doc.text('COST CENTRE', left, y);
      doc.text('SUBTOTAL', cSubR - 90, y, { width: 90, align: 'right' });
      doc.text('HST', cTaxR - 90, y, { width: 90, align: 'right' });
      doc.text('TOTAL', cTotalR - 90, y, { width: 90, align: 'right' });
      y += 14;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
      y += 6;
      doc.font('Helvetica').fontSize(9);
      for (const b of breakdown) {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(b.code, left, y, { width: 120, continued: false });
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(b.name, left, y + 11, { width: cSubR - 90 - left - 8 });
        doc.fillColor(INK).font('Helvetica').fontSize(9);
        doc.text(money(b.subtotal, currency), cSubR - 90, y, { width: 90, align: 'right' });
        doc.text(money(b.tax, currency), cTaxR - 90, y, { width: 90, align: 'right' });
        doc.text(money(b.total, currency), cTotalR - 90, y, { width: 90, align: 'right' });
        y += 24;
        if (y > doc.page.height - 120) { doc.addPage(); y = 60; }
      }
      doc.moveTo(left, y).lineTo(right, y).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
      y += 6;
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text('The cost-centre split reconciles exactly to the invoice total.', left, y);
    }

    // ── Footer ──
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
      `Blue Bee · ${inv.account.name} · Invoice ${inv.number ?? inv.id} · ${inv.status}`,
      left,
      doc.page.height - 60,
      { width, align: 'center' },
    );

    doc.end();
    return done;
  }

  private sectionHeading(doc: PDFKit.PDFDocument, label: string, left: number, right: number, y: number): number {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(label, left, y);
    return y + 20;
  }

  private totalRow(doc: PDFKit.PDFDocument, label: string, value: string, leftX: number, right: number, y: number, strong: boolean): number {
    doc.fillColor(strong ? INK : MUTED).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 12 : 10);
    doc.text(label, leftX, y, { width: 120 });
    doc.text(value, right - 130, y, { width: 130, align: 'right' });
    return y + (strong ? 20 : 16);
  }
}
