import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export type SendMailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getFromAddress(): string {
    return this.configService.get<string>('mail.from') ?? 'noreply@erp.local';
  }

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const host = this.configService.get<string>('mail.host');
    const user = this.configService.get<string>('mail.user');
    const password = this.configService.get<string>('mail.password');
    const port = this.configService.get<number>('mail.port') ?? 587;

    if (!host || !user || !password) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });

    return this.transporter;
  }

  async sendMail(params: SendMailParams): Promise<{ sent: boolean; stub?: boolean }> {
    const transporter = this.getTransporter();

    if (!transporter) {
      this.logger.warn(
        `Mail not configured — stub send to ${params.to}: ${params.subject}`,
      );
      return { sent: false, stub: true };
    }

    await transporter.sendMail({
      from: this.getFromAddress(),
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html ?? params.text.replace(/\n/g, '<br/>'),
    });

    this.logger.log(`Email sent to ${params.to}: ${params.subject}`);
    return { sent: true };
  }
}
