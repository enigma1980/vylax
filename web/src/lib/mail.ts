import nodemailer from 'nodemailer';

interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(opts: MailOptions): Promise<void> {
  // En desarrollo sin SMTP configurado → log por consola
  if (!process.env.SMTP_HOST) {
    console.log('\n── Correo (modo desarrollo) ───────────────────────────────');
    console.log(`  Para:    ${opts.to}`);
    console.log(`  Asunto:  ${opts.subject}`);
    console.log(`  Texto:   ${opts.text}`);
    console.log('───────────────────────────────────────────────────────────\n');
    return;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? 'Guaitiq <noreply@guaitiq.com>',
    to:   opts.to,
    subject: opts.subject,
    text:    opts.text,
    html:    opts.html,
  });
}
