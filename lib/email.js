/**
 * Email Helper — Shared Library
 * Sends emails via Gmail SMTP using nodemailer.
 * Credentials are injected from Vercel environment variables.
 */

import nodemailer from "nodemailer";
import { createLogger } from "./logger.js";

const logger = createLogger("email");

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_PASS;

  if (!user || !pass) {
    throw new Error("Gmail SMTP credentials not configured (GMAIL_SMTP_USER, GMAIL_SMTP_PASS)");
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  return _transporter;
}

/**
 * Send an email.
 * @param {{ to: string, subject: string, text?: string, html?: string, from?: string }} options
 */
export async function sendEmail({ to, subject, text, html, from }) {
  const transporter = getTransporter();
  const defaultFrom = `AVfreelance <${process.env.GMAIL_SMTP_USER}>`;

  const info = await transporter.sendMail({
    from: from || defaultFrom,
    to,
    subject,
    text,
    html,
  });

  logger.info(`Email sent to ${to}: messageId=${info.messageId}`);
  return info;
}

/**
 * Send a bulk email to multiple recipients.
 * @param {Array<{to: string, subject: string, text?: string, html?: string}>} emails
 * @param {{ delayMs?: number }} options
 */
export async function sendBulkEmails(emails, { delayMs = 1000 } = {}) {
  const results = { sent: 0, failed: 0, errors: [] };

  for (const email of emails) {
    try {
      await sendEmail(email);
      results.sent++;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    } catch (err) {
      results.failed++;
      results.errors.push({ to: email.to, error: err.message });
      logger.error(`Failed to send email to ${email.to}: ${err.message}`);
    }
  }

  return results;
}

export default { sendEmail, sendBulkEmails };
