import Notification from "../models/Notification.js";
import Settings from "../models/Settings.js";

import { getSupportGroupMembers } from "./microsoftGraphService.js";

import { sendEmail } from "./emailService.js";

const uniqueRecipients = (ids) => [...new Set((ids || []).filter(Boolean).map(String))];

const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const getEmailPreference = (event) => {
  const preferences = {
    ticket_created: "ticketCreated",
    new_message: "newMessage",
    internalNote: "internalNote",
    ticket_closed: "ticketClosed",
  };

  return preferences[event];
};

async function deliverNotificationEmails({
  recipients,
  emailByRecipient,
  title,
  ticket,
  message,
  ticketId,
  emailEvent,
}) {
  try {
    const settings = await Settings.findOne({ key: "global" });

    if (!settings?.smtp?.configured) {
      return;
    }

    const preference = getEmailPreference(emailEvent);

    if (!preference || settings.notifications?.[preference] === false) {
      return;
    }

    const emailJobs = recipients.map(async (recipientId) => {
      const email = emailByRecipient?.[recipientId];

      if (!email) {
        console.warn(`No email address available for notification recipient ${recipientId}.`);
        return;
      }

      const safeTitle = escapeHtml(title);
      const safeMessage = escapeHtml(message);

      const html = `
        <div style="font-family:Century Gothic,Arial,sans-serif;max-width:600px;margin:0px;color:#333">
          <div style="padding:24px;background:#f5f3ff;border-bottom:3px solid #7c3aed">
            <h2 style="margin:0;color:#5b21b6">MIS Helpdesk</h2>
          </div>
          <div style="padding:24px 18px">
            <h3>${safeTitle}</h3>
            <p>${safeMessage}</p>
            <p style="color:#777;font-size:12px">
              Ticket number: ${escapeHtml(ticket?.ticketNumber)}
            </p>
            <p style="color:#5b21b6;font-size:12px">
              <a href='${process.env.CLIENT_ORIGIN || "http://localhost:3000"}/tickets/${escapeHtml(ticketId)}'>View Ticket</a>
            </p>
          </div>
          <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">
            This is an automated notification from the MIS Helpdesk. Please do not reply to this message.
          </div>
        </div>
      `;

      await sendEmail({
        to: email,
        subject: title,
        text: `${message}\n\nTicket reference: ${ticketId}`,
        html,
      });
    });

    const results = await Promise.allSettled(emailJobs);

    const successful = results.filter((result) => result.status === "fulfilled").length;

    const failed = results.length - successful;

    console.log(`[Email notifications] ${successful} sent, ${failed} failed.`);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Email notification failed for recipient ${recipients[index]}:`,
          result.reason?.message,
        );
      }
    });
  } catch (error) {
    console.error("Email notification processing failed:", error.message);
  }
}

export const notifyUsers = async ({
  recipients,
  type,
  title,
  ticket,
  message,
  ticketId,
  emailByRecipient = {},
  emailEvent = type,
}) => {
  const recipientIds = uniqueRecipients(recipients);

  if (!recipientIds.length) {
    console.log("No notification recipients found.");
    return;
  }

  // Save in-app notifications independently of email delivery.
  try {
    await Notification.insertMany(
      recipientIds.map((recipientId) => ({
        recipientId,
        type,
        title,
        message,
        ticketId,
      })),
      { ordered: false },
    );

    console.log(`Saved ${recipientIds.length} in-app notification(s).`);
  } catch (error) {
    console.error("Notification database insert error:", error);
  }

  // Email failures must never interrupt ticket operations.
  await deliverNotificationEmails({
    recipients: recipientIds,
    emailByRecipient,
    title,
    message,
    ticketId,
    ticket,
    emailEvent,
  });
};

const getSupportRecipientDetails = async () => {
  const members = await getSupportGroupMembers();

  return {
    recipients: uniqueRecipients(members.map((member) => member.id)),
    emailByRecipient: Object.fromEntries(
      members.filter((member) => member.email).map((member) => [member.id, member.email]),
    ),
  };
};

export const getSupportNotificationRecipients = async () => {
  const { recipients } = await getSupportRecipientDetails();
  return recipients;
};

export const notifySupportTeam = async ({ excludeUserId, emailEvent, ...notification }) => {
  try {
    const { recipients, emailByRecipient } = await getSupportRecipientDetails();

    const filteredRecipients = recipients.filter((id) => id !== String(excludeUserId || ""));

    await notifyUsers({
      ...notification,
      emailEvent: emailEvent || notification.type,
      recipients: filteredRecipients,
      emailByRecipient,
    });
  } catch (error) {
    console.error("Support team notification failed:", error.message);
  }
};

export const notifyTicketParticipants = async ({
  ticket,
  excludeUserId,
  emailEvent,
  ...notification
}) => {
  const recipients = uniqueRecipients([
    ticket.requesterId,
    ticket.assigneeId,
    ...(ticket.messages || []).map((item) => item.authorId),
  ]).filter((id) => id !== String(excludeUserId || ""));

  const emailByRecipient = {};

  if (ticket.requesterId && ticket.requesterEmail) {
    emailByRecipient[String(ticket.requesterId)] = ticket.requesterEmail;
  }

  for (const item of ticket.messages || []) {
    if (item.authorId && item.authorEmail) {
      emailByRecipient[String(item.authorId)] = item.authorEmail;
    }
  }

  // Resolve missing addresses from the IT Support group.
  // Requesters and previous message authors are already
  // resolved using the email addresses stored on the ticket.
  const unresolved = recipients.filter((id) => !emailByRecipient[id]);

  if (unresolved.length) {
    try {
      const supportMembers = await getSupportGroupMembers();

      for (const member of supportMembers) {
        if (unresolved.includes(member.id) && member.email) {
          emailByRecipient[member.id] = member.email;
        }
      }
    } catch (error) {
      console.error("Unable to resolve support member email addresses:", error.message);
    }
  }

  await notifyUsers({
    ...notification,
    emailEvent: emailEvent || notification.type,
    recipients,
    emailByRecipient,
    ticket,
  });
};
