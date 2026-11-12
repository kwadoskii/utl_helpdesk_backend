import nodemailer from "nodemailer";

import Settings from "../models/Settings.js";
import { decrypt } from "../utils/encryption.js";

async function getSmtpConfiguration() {
  const settings = await Settings.findOne({ key: "global" });

  if (!settings?.smtp?.configured) {
    throw new Error("SMTP has not been configured.");
  }

  const smtp = settings.smtp;

  if (!smtp.host || !smtp.port || !smtp.username || !smtp.passwordEncrypted || !smtp.senderEmail) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return {
    host: smtp.host,
    port: Number(smtp.port),
    encryption: smtp.encryption,
    username: smtp.username,
    password: decrypt(smtp.passwordEncrypted),
    senderName: smtp.senderName,
    senderEmail: smtp.senderEmail,
  };
}

function createTransporter(config) {
  const secure = config.encryption === "ssl";

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: config.encryption === "starttls",
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

export async function verifySmtpConnection() {
  const config = await getSmtpConfiguration();
  const transporter = createTransporter(config);

  try {
    await transporter.verify();
    return { success: true, message: "SMTP connection verified." };
  } finally {
    transporter.close();
  }
}

export async function sendEmail({ to, subject, text, html }) {
  const config = await getSmtpConfiguration();
  const transporter = createTransporter(config);

  try {
    const result = await transporter.sendMail({
      from: {
        name: config.senderName,
        address: config.senderEmail,
      },
      to,
      subject,
      text,
      html,
    });

    return {
      success: true,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    };
  } finally {
    transporter.close();
  }
}

export async function sendTestEmail(recipient) {
  const config = await getSmtpConfiguration();

  const transporter = createTransporter(config);

  try {
    await transporter.verify();

    const result = await transporter.sendMail({
      from: {
        name: config.senderName,
        address: config.senderEmail,
      },
      to: recipient,
      subject: "Helpdesk SMTP Configuration Test",
      text: [
        "Hello,",
        "",
        "This is a test email from your MIS Helpdesk system.",
        "",
        "Your SMTP configuration is working correctly.",
        "",
        "Regards,",
        config.senderName,
      ].join("\n"),
      html: `
        <div style="font-family:Century Gothic,Arial,sans-serif;max-width:600px;margin:0px;padding:4px;color:#333">
          <h4>SMTP Configuration Test</h4>
          <p>Hello,</p>
          <p>This is a test email from your MIS Helpdesk system.</p>
          <p>Your SMTP configuration is working correctly.<br/>
          </p>
          <p>Regards,<br/><strong>${config.senderName}</strong></p>
        </div>
      `,
    });

    return {
      success: true,
      messageId: result.messageId,
      message: "Test email sent successfully.",
    };
  } finally {
    transporter.close();
  }
}
