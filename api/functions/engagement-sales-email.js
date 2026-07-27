/**
 * Engagement Sales Email — Serverless Function
 * Sends personalized sales emails to high-value leads identified
 * by the engagement detector. Uses Gmail SMTP for delivery.
 *
 * Triggered by: POST from engagement-engine cron
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";
import { sendEmail } from "../../lib/email.js";

const logger = createLogger("engagement-sales-email");

const EMAIL_TEMPLATES = {
  "event-planner": {
    subject: "AV Technicians Available for Your Events — AVfreelance",
    body: (name, company) => `Hi ${name},

I noticed ${company || "your company"} produces events and wanted to reach out about AVfreelance — a platform that connects event producers with vetted, professional AV technicians nationwide.

What we offer:
• Pre-vetted AV technicians available on-demand
• Audio, video, and lighting specialists for any event size
• Fast booking — technicians confirmed within hours
• Transparent pricing with no hidden fees

Whether you need a full AV crew for a corporate conference or a single technician for a small event, AVfreelance has you covered.

Would you be open to a quick 15-minute call to see how we can support your upcoming events?

Best regards,
The AVfreelance Team
https://avfreelance.com
`,
  },
  "av-professional": {
    subject: "Find Premium AV Gigs Near You — AVfreelance",
    body: (name) => `Hi ${name},

I came across your profile and wanted to share AVfreelance — a platform built specifically for AV professionals like you to find premium freelance gigs.

What AVfreelance offers technicians:
• Access to corporate, concert, and conference AV jobs
• Transparent pay rates — no surprises
• Build your professional profile and get discovered
• Work with top event companies nationwide

Joining is free and takes less than 5 minutes. Start finding gigs that match your skills today.

Sign up at: https://avfreelance.com/join

Best,
The AVfreelance Team
`,
  },
  "default": {
    subject: "Connect with Top AV Professionals — AVfreelance",
    body: (name) => `Hi ${name},

I wanted to introduce you to AVfreelance — the platform connecting AV professionals and event producers nationwide.

Whether you're looking to hire AV talent or find your next gig, AVfreelance makes it simple, fast, and professional.

Learn more at: https://avfreelance.com

Best regards,
The AVfreelance Team
`,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { leads = [] } = req.body || {};
  if (!leads.length) {
    return res.status(200).json({ success: true, message: "No leads to email", emailsSent: 0 });
  }

  logger.info(`Processing ${leads.length} leads for sales email`);
  const results = { emailsSent: 0, skipped: 0, errors: [] };

  for (const lead of leads) {
    if (!lead.email) {
      results.skipped++;
      continue;
    }

    try {
      const templateKey = lead.type || "default";
      const template = EMAIL_TEMPLATES[templateKey] || EMAIL_TEMPLATES["default"];
      const subject = template.subject;
      const body = template.body(lead.name || "there", lead.company);

      await sendEmail({
        to: lead.email,
        subject,
        text: body,
        from: `AVfreelance <${process.env.GMAIL_SMTP_USER}>`,
      });

      // Log email send to AVfreelance CRM
      await callAVfreelance("/api/cron/log-email-outreach", {
        method: "POST",
        body: {
          leadId: lead.id,
          email: lead.email,
          subject,
          templateKey,
          sentAt: new Date().toISOString(),
        },
      });

      results.emailsSent++;
      logger.info(`Sales email sent to ${lead.email}`);

      // Rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      logger.error(`Email failed for ${lead.email}: ${err.message}`);
      results.errors.push({ email: lead.email, error: err.message });
    }
  }

  results.skipped += leads.filter((l) => !l.email).length;

  logger.info(`Email campaign complete: ${results.emailsSent} sent, ${results.skipped} skipped`);
  return res.status(200).json({
    success: true,
    emailsSent: results.emailsSent,
    skipped: results.skipped,
    errors: results.errors.length,
    timestamp: new Date().toISOString(),
  });
}
