import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '@/infrastructure/mail/mail.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { buildInwardMail, MailField, MailLine } from './material-inward-mail.template';

const HOURS = {
  QC_PENDING: 4,
  SUPPLIER_IDLE: 48,
  REPLACEMENT_OVERDUE: 72,
} as const;

type QueueInput = {
  companyId: bigint;
  eventCode: string;
  docType: string;
  docId: bigint;
  roleCode?: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  taskId?: bigint;
  sendNow?: boolean;
};

@Injectable()
export class MaterialInwardMailService {
  private readonly logger = new Logger(MaterialInwardMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async afterGrnSubmitted(companyId: string, grnId: string) {
    const company = parseBigIntId(companyId);
    const grn = await this.prisma.miGrnHeader.findFirst({
      where: { id: parseBigIntId(grnId), companyId: company },
      include: { lines: true, po: true },
    });
    if (!grn) return;
    if (grn.receiptType === 'REPLACEMENT' && grn.supplierCaseId) {
      await this.cancel(company, 'REPLACEMENT_OVERDUE', 'CASE', grn.supplierCaseId);
    }
    const excess = grn.lines.filter((line) => line.excessStatus === 'PENDING_APPROVAL');
    if (excess.length) {
      const qty = excess.reduce((sum, line) => sum + Number(line.excessQty), 0);
      const buyerEmail = grn.po.buyerId ? await this.emailForUser(grn.po.buyerId) : null;
      const recipients = buyerEmail ? [buyerEmail] : await this.emailsForRole(company, 'BUYER');
      await this.queueMany(recipients.map((toEmail) => ({
        companyId: company,
        eventCode: 'EXCESS_FLAGGED',
        docType: 'GRN',
        docId: grn.id,
        roleCode: 'BUYER',
        toEmail,
        subject: `Excess stock on ${grn.po.poNo}`,
        body: `${grn.grnNo} for ${grn.po.poNo} is above the over-receipt tolerance. Excess quantity ${qty}. Review the receipt and accept or reject the extra quantity.`,
        scheduledAt: new Date(),
        sendNow: true,
      })));
    }
    if (grn.status !== 'QC_PENDING') return;
    const qc = await this.prisma.miQcInspection.findFirst({
      where: { companyId: company, grnId: grn.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!qc) return;
    const received = grn.lines.reduce((sum, line) => sum + Number(line.receivedQty), 0);
    const qcRecipients = await this.emailsForRole(company, 'QC');
    await this.queueMany(qcRecipients.map((toEmail) => ({
      companyId: company,
      eventCode: 'GRN_SUBMITTED',
      docType: 'QC',
      docId: qc.id,
      roleCode: 'QC',
      toEmail,
      subject: `Inspection waiting for ${grn.po.poNo}`,
      body: `${grn.grnNo} for ${grn.po.poNo} is on the dock. Quantity ${received} is waiting for inspection (${qc.qcNo}).`,
      scheduledAt: new Date(),
      sendNow: true,
    })));
    const task = await this.prisma.miTask.findFirst({
      where: { companyId: company, docType: 'QC', docId: qc.id, taskType: 'QC_INSPECT', status: 'OPEN' },
    });
    const supervisors = await this.emailsForRole(company, 'QC_SUPERVISOR');
    await this.queueMany(supervisors.map((toEmail) => ({
      companyId: company,
      eventCode: 'QC_PENDING',
      docType: 'QC',
      docId: qc.id,
      taskId: task?.id,
      roleCode: 'QC_SUPERVISOR',
      toEmail,
      subject: `QC queue still open for ${qc.qcNo}`,
      body: `${qc.qcNo} for ${grn.grnNo} is still pending after ${HOURS.QC_PENDING} hours. Reassign an inspector.`,
      scheduledAt: this.afterHours(HOURS.QC_PENDING),
    })));
  }

  async afterQcCompleted(companyId: string, qcId: string) {
    const company = parseBigIntId(companyId);
    const qc = await this.prisma.miQcInspection.findFirst({
      where: { id: parseBigIntId(qcId), companyId: company },
      include: { lines: true },
    });
    if (!qc) return;
    await this.cancel(company, 'QC_PENDING', 'QC', qc.id);
    const grn = await this.prisma.miGrnHeader.findFirst({
      where: { id: qc.grnId, companyId: company },
      include: { po: true },
    });
    if (!grn) return;
    const accepted = qc.lines.reduce((sum, line) => sum + Number(line.acceptedQty), 0);
    const rejected = qc.lines.reduce((sum, line) => sum + Number(line.rejectedQty), 0);
    const supplierCase = await this.prisma.miSupplierCase.findFirst({
      where: { companyId: company, qcId: qc.id },
    });
    const caseText = supplierCase ? ` Supplier case ${supplierCase.caseNo} is open.` : '';
    const body = `${qc.qcNo} for ${grn.po.poNo} is complete. Accepted ${accepted} is waiting for put-away. Rejected ${rejected}.${caseText}`;
    const buyers = await this.emailsForRole(company, 'BUYER');
    const storekeepers = await this.emailsForRole(company, 'STOREKEEPER');
    const seen = new Set<string>();
    const recipients = [...buyers.map((email) => ({ email, role: 'BUYER' })), ...storekeepers.map((email) => ({ email, role: 'STOREKEEPER' }))]
      .filter((row) => {
        const key = `${row.role}:${row.email}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    await this.queueMany(recipients.map((row) => ({
      companyId: company,
      eventCode: 'QC_COMPLETE',
      docType: 'QC',
      docId: qc.id,
      roleCode: row.role,
      toEmail: row.email,
      subject: `QC complete for ${grn.po.poNo}`,
      body,
      scheduledAt: new Date(),
      sendNow: true,
    })));
    if (!supplierCase) return;
    const caseBuyers = buyers.length ? buyers : await this.emailsForRole(company, 'BUYER');
    await this.queueMany(caseBuyers.map((toEmail) => ({
      companyId: company,
      eventCode: 'SUPPLIER_IDLE',
      docType: 'CASE',
      docId: supplierCase.id,
      roleCode: 'BUYER',
      toEmail,
      subject: `Supplier case ${supplierCase.caseNo} has no resolution`,
      body: `${supplierCase.caseNo} for ${grn.po.poNo} has been open for ${HOURS.SUPPLIER_IDLE} hours with no split. Contact the vendor.`,
      scheduledAt: this.afterHours(HOURS.SUPPLIER_IDLE),
    })));
  }

  async afterCaseLines(companyId: string, caseId: string, resolutionTypes: string[]) {
    const company = parseBigIntId(companyId);
    const id = parseBigIntId(caseId);
    await this.cancel(company, 'SUPPLIER_IDLE', 'CASE', id);
    if (!resolutionTypes.includes('REPLACEMENT')) return;
    const existing = await this.prisma.miEmailDispatch.count({
      where: { companyId: company, eventCode: 'REPLACEMENT_OVERDUE', docType: 'CASE', docId: id, status: { in: ['SCHEDULED', 'SENT'] } },
    });
    if (existing) return;
    const supplierCase = await this.prisma.miSupplierCase.findFirst({ where: { id, companyId: company } });
    if (!supplierCase) return;
    const managers = await this.emailsForRole(company, 'PURCHASE_MANAGER');
    await this.queueMany(managers.map((toEmail) => ({
      companyId: company,
      eventCode: 'REPLACEMENT_OVERDUE',
      docType: 'CASE',
      docId: id,
      roleCode: 'PURCHASE_MANAGER',
      toEmail,
      subject: `Replacement overdue for ${supplierCase.caseNo}`,
      body: `The replacement for ${supplierCase.caseNo} is still outstanding after ${HOURS.REPLACEMENT_OVERDUE} hours. Follow up with the vendor.`,
      scheduledAt: this.afterHours(HOURS.REPLACEMENT_OVERDUE),
    })));
  }

  async cancelQcPending(companyId: string, qcId: string) {
    await this.cancel(parseBigIntId(companyId), 'QC_PENDING', 'QC', parseBigIntId(qcId));
  }

  async processDue() {
    const due = await this.prisma.miEmailDispatch.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    });
    let sent = 0;
    let cancelled = 0;
    let failed = 0;
    for (const row of due) {
      const stillDue = await this.stillDue(row.companyId, row.eventCode, row.docType, row.docId);
      if (!stillDue) {
        await this.prisma.miEmailDispatch.update({
          where: { id: row.id },
          data: { status: 'CANCELLED', errorText: 'The document was already actioned' },
        });
        cancelled += 1;
        continue;
      }
      const result = await this.deliver(row.id, row.toEmail, row.subject, row.body);
      if (result === 'SENT') sent += 1;
      else failed += 1;
    }
    return { checked: due.length, sent, cancelled, failed };
  }

  async list(companyId: string, docType?: string, docId?: string, status?: string) {
    return serialize(await this.prisma.miEmailDispatch.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(docType ? { docType: docType.toUpperCase() } : {}),
        ...(docId ? { docId: parseBigIntId(docId) } : {}),
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }));
  }

  private async stillDue(companyId: bigint, eventCode: string, docType: string, docId: bigint) {
    if (eventCode === 'QC_PENDING') {
      const qc = await this.prisma.miQcInspection.findFirst({ where: { id: docId, companyId } });
      return qc?.status === 'PENDING';
    }
    if (eventCode === 'SUPPLIER_IDLE') {
      const lines = await this.prisma.miSupplierCaseLine.count({ where: { caseId: docId } });
      return lines === 0;
    }
    if (eventCode === 'REPLACEMENT_OVERDUE') {
      const received = await this.prisma.miGrnHeader.count({
        where: {
          companyId,
          supplierCaseId: docId,
          receiptType: 'REPLACEMENT',
          status: { notIn: ['DRAFT', 'REVERSED'] },
        },
      });
      return received === 0;
    }
    return true;
  }

  private async queueMany(rows: QueueInput[]) {
    if (!rows.length) {
      return;
    }
    for (const row of rows) {
      const duplicate = await this.prisma.miEmailDispatch.findFirst({
        where: {
          companyId: row.companyId,
          eventCode: row.eventCode,
          docType: row.docType,
          docId: row.docId,
          toEmail: row.toEmail,
          status: { in: ['SCHEDULED', 'SENT'] },
        },
      });
      if (duplicate) continue;
      const created = await this.prisma.miEmailDispatch.create({
        data: {
          companyId: row.companyId,
          eventCode: row.eventCode,
          docType: row.docType,
          docId: row.docId,
          taskId: row.taskId,
          roleCode: row.roleCode,
          toEmail: row.toEmail,
          subject: row.subject,
          body: row.body,
          status: 'SCHEDULED',
          scheduledAt: row.scheduledAt,
        },
      });
      if (row.sendNow) await this.deliver(created.id, created.toEmail, created.subject, created.body);
    }
  }

  private async deliver(id: bigint, toEmail: string, subject: string, body: string) {
    if (!toEmail || toEmail === 'missing') {
      await this.prisma.miEmailDispatch.update({
        where: { id },
        data: { status: 'FAILED', errorText: 'No recipient email for this designation' },
      });
      return 'FAILED';
    }
    try {
      const rendered = await this.renderMessage(id).catch((error) => {
        const message = error instanceof Error ? error.message : 'Template failed';
        this.logger.warn(`Inward mail template fell back to plain text: ${message}`);
        return null;
      });
      const text = rendered?.text || body;
      const result = await this.mail.sendMail({
        to: toEmail,
        subject,
        text,
        html: rendered?.html,
      });
      await this.prisma.miEmailDispatch.update({
        where: { id },
        data: result.sent
          ? { status: 'SENT', sentAt: new Date(), errorText: null, body: text.slice(0, 2000) }
          : { status: 'FAILED', errorText: 'Mail is not configured on the server' },
      });
      return result.sent ? 'SENT' : 'FAILED';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mail send failed';
      this.logger.warn(`Inward mail failed for ${toEmail}: ${message}`);
      await this.prisma.miEmailDispatch.update({
        where: { id },
        data: { status: 'FAILED', errorText: message.slice(0, 500) },
      });
      return 'FAILED';
    }
  }

  private async renderMessage(id: bigint) {
    const row = await this.prisma.miEmailDispatch.findUnique({ where: { id } });
    if (!row) return null;
    const company = await this.prisma.company.findFirst({
      where: { companyId: row.companyId, deletedAt: null },
      select: {
        name: true,
        legalName: true,
        companyCode: true,
        email: true,
        phone: true,
        taxNumber: true,
        logoUrl: true,
        timezone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
      },
    });
    if (!company) return null;
    const content = await this.templateContent(row.companyId, row.eventCode, row.docType, row.docId, row.roleCode);
    if (!content) return null;
    const address = [company.addressLine1, company.addressLine2, company.city, company.state, company.postalCode, company.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    return buildInwardMail({
      companyName: company.name,
      companyCode: company.companyCode,
      legalName: company.legalName,
      address,
      companyEmail: company.email,
      companyPhone: company.phone,
      taxNumber: company.taxNumber,
      logoUrl: this.absoluteLogo(company.logoUrl),
      audience: this.audienceLabel(row.roleCode),
      ...content,
    });
  }

  private async templateContent(
    companyId: bigint,
    eventCode: string,
    docType: string,
    docId: bigint,
    roleCode: string | null,
  ): Promise<{ title: string; intro: string; action: string; fields: MailField[]; lineTitle?: string; lineHeaders?: string[]; lines?: MailLine[] } | null> {
    if (eventCode === 'EXCESS_FLAGGED' || docType === 'GRN') {
      const pack = await this.loadGrn(companyId, docId);
      if (!pack) return null;
      const excessLines = pack.grn.lines.filter((line) => line.excessStatus === 'PENDING_APPROVAL' || Number(line.excessQty) > 0);
      return {
        title: 'Excess quantity needs a decision',
        intro: `${pack.grn.grnNo} for ${pack.po.poNo} is above the over-receipt tolerance. The extra quantity is not posted until you accept or reject it.`,
        action: 'Open the excess screen for this receipt and accept or reject the extra quantity.',
        fields: this.grnFields(pack),
        lineTitle: 'Quantities above tolerance',
        lineHeaders: ['Item', 'Ordered', 'Received', 'Excess', 'Tolerance', 'UOM'],
        lines: (excessLines.length ? excessLines : pack.grn.lines).map((line) => ({
          cells: [
            this.itemLabel(pack.items, line.itemId),
            this.qty(line.orderQtySnapshot),
            this.qty(line.receivedQty),
            this.qty(line.excessQty),
            `${this.qty(line.tolerancePctApplied)}%`,
            line.uomCode,
          ],
        })),
      };
    }
    if (eventCode === 'GRN_SUBMITTED' || eventCode === 'QC_PENDING' || eventCode === 'QC_COMPLETE') {
      const qc = await this.prisma.miQcInspection.findFirst({
        where: { id: docId, companyId },
        include: { lines: true },
      });
      if (!qc) return null;
      const pack = await this.loadGrn(companyId, qc.grnId);
      if (!pack) return null;
      const supplierCase = await this.prisma.miSupplierCase.findFirst({
        where: { companyId, qcId: qc.id },
        include: { lines: true },
      });
      const accepted = qc.lines.reduce((sum, line) => sum + Number(line.acceptedQty), 0);
      const rejected = qc.lines.reduce((sum, line) => sum + Number(line.rejectedQty), 0);
      const received = pack.grn.lines.reduce((sum, line) => sum + Number(line.receivedQty), 0);
      const base = [
        ...this.grnFields(pack),
        { label: 'QC number', value: qc.qcNo },
        { label: 'QC status', value: this.label(qc.status) },
        { label: 'Inspection date', value: this.day(qc.inspectionDate) },
        { label: 'Overall result', value: qc.overallResult ? this.label(qc.overallResult) : '—' },
      ];
      if (eventCode === 'QC_COMPLETE') {
        return {
          title: 'Inspection is complete',
          intro: `${qc.qcNo} for ${pack.po.poNo} is complete. Accepted quantity is waiting for put-away.${supplierCase ? ` Supplier case ${supplierCase.caseNo} is open for the rejected quantity.` : ''}`,
          action: roleCode === 'STOREKEEPER'
            ? 'Put away the accepted quantity from the dock into the suggested bin.'
            : 'Review the accepted quantity and the supplier case, if one was opened.',
          fields: [
            ...base,
            { label: 'Accepted quantity', value: this.qty(accepted) },
            { label: 'Rejected quantity', value: this.qty(rejected) },
            { label: 'Supplier case', value: supplierCase?.caseNo || 'None' },
          ],
          lineTitle: 'Inspection lines',
          lineHeaders: ['Item', 'Inspected', 'Accepted', 'Rejected', 'Reason'],
          lines: qc.lines.map((line) => {
            const grnLine = pack.grn.lines.find((candidate) => candidate.id === line.grnLineId);
            return {
              cells: [
                this.itemLabel(pack.items, grnLine?.itemId),
                this.qty(line.inspectQty),
                this.qty(line.acceptedQty),
                this.qty(line.rejectedQty),
                line.rejectionReasonCode ? this.label(line.rejectionReasonCode) : '—',
              ],
            };
          }),
        };
      }
      const waiting = eventCode === 'QC_PENDING';
      return {
        title: waiting ? 'Inspection is still waiting' : 'Goods are waiting for inspection',
        intro: waiting
          ? `${qc.qcNo} for ${pack.grn.grnNo} is still pending ${HOURS.QC_PENDING} hours after the receipt was submitted.`
          : `${pack.grn.grnNo} for ${pack.po.poNo} is on the dock. Quantity ${this.qty(received)} is waiting for inspection.`,
        action: waiting
          ? 'Reassign an inspector so this receipt does not stay on the dock.'
          : 'Open the quality queue and inspect this receipt.',
        fields: [
          ...base,
          { label: 'Quantity on dock', value: this.qty(received) },
          { label: 'Submitted at', value: this.when(pack.grn.submittedAt, pack.timezone) },
          ...(waiting ? [{ label: 'Escalation after', value: `${HOURS.QC_PENDING} hours` }] : []),
        ],
        lineTitle: 'Received lines',
        lineHeaders: ['Item', 'Ordered', 'Received', 'UOM', 'Delivery note'],
        lines: pack.grn.lines.map((line) => ({
          cells: [
            this.itemLabel(pack.items, line.itemId),
            this.qty(line.orderQtySnapshot),
            this.qty(line.receivedQty),
            line.uomCode,
            pack.grn.supplierDoNo || '—',
          ],
        })),
      };
    }
    if (eventCode === 'SUPPLIER_IDLE' || eventCode === 'REPLACEMENT_OVERDUE') {
      const supplierCase = await this.prisma.miSupplierCase.findFirst({
        where: { id: docId, companyId },
        include: { lines: true },
      });
      if (!supplierCase) return null;
      const pack = await this.loadGrn(companyId, supplierCase.grnId);
      if (!pack) return null;
      const vendor = await this.vendorLabel(supplierCase.supplierId);
      const replacement = eventCode === 'REPLACEMENT_OVERDUE';
      const relevant = replacement
        ? supplierCase.lines.filter((line) => line.resolutionType === 'REPLACEMENT')
        : supplierCase.lines;
      return {
        title: replacement ? 'Replacement receipt is overdue' : 'Supplier case has no resolution',
        intro: replacement
          ? `The replacement for ${supplierCase.caseNo} has not arrived ${HOURS.REPLACEMENT_OVERDUE} hours after the resolution was saved.`
          : `${supplierCase.caseNo} for ${pack.po.poNo} has been open for ${HOURS.SUPPLIER_IDLE} hours with no split saved.`,
        action: replacement
          ? 'Follow up with the vendor and record the replacement receipt when it arrives.'
          : 'Contact the vendor and save the return, replacement, or other split on this case.',
        fields: [
          { label: 'Case number', value: supplierCase.caseNo },
          { label: 'Case status', value: this.label(supplierCase.status) },
          { label: 'Opened at', value: this.when(supplierCase.createdAt, pack.timezone) },
          { label: 'Due at', value: this.when(supplierCase.dueAt, pack.timezone) },
          { label: 'Vendor', value: vendor },
          { label: 'Purchase order', value: pack.po.poNo },
          { label: 'Goods receipt', value: pack.grn.grnNo },
          { label: 'Warehouse', value: pack.warehouse },
          { label: 'Wait threshold', value: `${replacement ? HOURS.REPLACEMENT_OVERDUE : HOURS.SUPPLIER_IDLE} hours` },
        ],
        lineTitle: replacement ? 'Replacement lines' : 'Case lines',
        lineHeaders: ['Reason', 'Rejected', 'Resolution', 'Remaining', 'Status'],
        lines: (relevant.length ? relevant : supplierCase.lines).map((line) => ({
          cells: [
            line.rejectionReasonCode ? this.label(line.rejectionReasonCode) : '—',
            this.qty(line.rejectedQty),
            this.label(line.resolutionType),
            this.qty(line.remainingQty),
            this.label(line.status),
          ],
        })),
      };
    }
    return null;
  }

  private async loadGrn(companyId: bigint, grnId: bigint) {
    const grn = await this.prisma.miGrnHeader.findFirst({
      where: { id: grnId, companyId },
      include: { lines: true, po: true },
    });
    if (!grn) return null;
    const company = await this.prisma.company.findFirst({
      where: { companyId },
      select: { timezone: true },
    });
    const [vendor, warehouse, items] = await Promise.all([
      this.prisma.vendor.findFirst({
        where: { vendorId: grn.supplierId },
        select: { vendorCode: true, name: true },
      }),
      this.prisma.warehouse.findFirst({
        where: { warehouseId: grn.warehouseId },
        select: { warehouseCode: true, name: true },
      }),
      this.prisma.item.findMany({
        where: { itemId: { in: [...new Set(grn.lines.map((line) => line.itemId))] } },
        select: { itemId: true, itemCode: true, description: true },
      }),
    ]);
    return {
      grn,
      po: grn.po,
      timezone: company?.timezone || 'UTC',
      vendor: vendor ? `${vendor.vendorCode} — ${vendor.name}` : '—',
      warehouse: warehouse ? `${warehouse.warehouseCode} — ${warehouse.name}` : '—',
      items,
    };
  }

  private grnFields(pack: Awaited<ReturnType<MaterialInwardMailService['loadGrn']>> & object): MailField[] {
    return [
      { label: 'Goods receipt', value: pack.grn.grnNo },
      { label: 'Receipt status', value: this.label(pack.grn.status) },
      { label: 'Receipt type', value: this.label(pack.grn.receiptType) },
      { label: 'Purchase order', value: pack.po.poNo },
      { label: 'PO date', value: this.day(pack.po.poDate) },
      { label: 'PO status', value: this.label(pack.po.status) },
      { label: 'Vendor', value: pack.vendor },
      { label: 'Delivery note', value: pack.grn.supplierDoNo || '—' },
      { label: 'Delivery date', value: this.day(pack.grn.deliveryDate) },
      { label: 'Warehouse', value: pack.warehouse },
      { label: 'Packaging', value: pack.grn.packagingCondition ? this.label(pack.grn.packagingCondition) : '—' },
      { label: 'Submitted at', value: this.when(pack.grn.submittedAt, pack.timezone) },
      { label: 'Remarks', value: pack.grn.remarks || pack.po.remarks || '—' },
    ];
  }

  private async vendorLabel(vendorId: bigint) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { vendorId },
      select: { vendorCode: true, name: true },
    });
    return vendor ? `${vendor.vendorCode} — ${vendor.name}` : '—';
  }

  private itemLabel(items: { itemId: bigint; itemCode: string; description: string }[], itemId?: bigint) {
    const item = items.find((candidate) => itemId && candidate.itemId === itemId);
    return item ? `${item.itemCode} — ${item.description}` : '—';
  }

  private audienceLabel(roleCode: string | null) {
    const labels: Record<string, string> = {
      QC: 'QC / Inspector',
      BUYER: 'Buyer',
      STOREKEEPER: 'Storekeeper',
      QC_SUPERVISOR: 'QC Supervisor',
      PURCHASE_MANAGER: 'Purchase Manager',
    };
    return roleCode ? labels[roleCode] || this.label(roleCode) : 'Material inward team';
  }

  private label(value: string) {
    return value
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private qty(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  }

  private day(value: Date | null | undefined) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
  }

  private when(value: Date | null | undefined, timeZone: string) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timeZone || 'UTC',
      }).format(value);
    } catch {
      return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value);
    }
  }

  private absoluteLogo(raw: string | null) {
    const value = raw?.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (!value.startsWith('/')) return null;
    const origin = String(this.config.get<string>('app.frontendOrigin') || 'http://localhost:3001')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
    return `${origin}${value}`;
  }

  private async cancel(companyId: bigint, eventCode: string, docType: string, docId: bigint) {
    await this.prisma.miEmailDispatch.updateMany({
      where: { companyId, eventCode, docType, docId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', errorText: 'No longer due' },
    });
  }

  private async emailsForRole(companyId: bigint, roleCode: string) {
    const memberships = await this.prisma.userCompany.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'active',
        user: { deletedAt: null, isActive: true },
        designation: {
          deletedAt: null,
          isActive: true,
          designationCode: { equals: roleCode, mode: 'insensitive' },
        },
      },
      select: { user: { select: { email: true } } },
    });
    const emails = [...new Set(memberships.map((row) => row.user.email).filter(Boolean))];
    return emails.length ? emails : ['missing'];
  }

  private async emailForUser(userId: bigint) {
    const user = await this.prisma.user.findFirst({
      where: { userId, deletedAt: null, isActive: true },
      select: { email: true },
    });
    return user?.email || null;
  }

  private afterHours(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}
