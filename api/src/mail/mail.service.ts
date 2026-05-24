import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    return Boolean(host && from);
  }

  async sendDocumentPdf(opts: {
    to: string[];
    subject: string;
    text: string;
    absolutePdfPath: string;
    attachmentName: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('SMTP_NOT_CONFIGURED');
    }

    const host = this.config.get<string>('SMTP_HOST')!.trim();
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    const secure =
      this.config.get<string>('SMTP_SECURE') === 'true' || port === 465;
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const from = this.config.get<string>('SMTP_FROM')!.trim();

    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    const pdfBuffer = readFileSync(opts.absolutePdfPath);
    const mail: Mail.Options = {
      from,
      to: opts.to.join(', '),
      subject: opts.subject,
      text: opts.text,
      attachments: [
        {
          filename: opts.attachmentName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    await transport.sendMail(mail);
    this.logger.log(`Document email sent to ${opts.to.length} recipient(s)`);
  }
}
