import Notification from "../models/Notification.js";
import { getSupportGroupMemberIds } from "./microsoftGraphService.js";

const uniqueRecipients = (ids) => [...new Set(ids.filter(Boolean).map(String))];

export const notifyUsers = async ({ recipients, type, title, message, ticketId }) => {
  const recipientIds = uniqueRecipients(recipients || []);

  if (!recipientIds.length) {
    console.log("No notification recipients found.");
    return;
  }

  try {
    const result = await Notification.insertMany(
      recipientIds.map((recipientId) => ({
        recipientId,
        type,
        title,
        message,
        ticketId,
      })),
      { ordered: false },
    );
  } catch (error) {
    console.error("Notification insert error:", error);
  }
};

// Dynamically retrieve IT Support members from Microsoft Entra ID.
const getSupportRecipientIds = async () => {
  try {
    const memberIds = await getSupportGroupMemberIds();

    return uniqueRecipients(memberIds);
  } catch (error) {
    console.error("Failed to retrieve IT Support group members:", error.message);

    return [];
  }
};

export const notifySupportTeam = async ({ excludeUserId, ...notification }) => {
  const supportRecipients = await getSupportRecipientIds();

  const recipients = supportRecipients.filter((id) => id !== String(excludeUserId));

  console.log("Support notification recipients:", recipients);

  await notifyUsers({
    ...notification,
    recipients,
  });
};

export const notifyTicketParticipants = async ({ ticket, excludeUserId, ...notification }) => {
  const recipients = uniqueRecipients([ticket.requesterId, ticket.assigneeId]).filter(
    (id) => id !== String(excludeUserId),
  );

  await notifyUsers({
    ...notification,
    recipients,
  });
};

// Exported for use elsewhere in the ticketing system.
export const getSupportNotificationRecipients = getSupportRecipientIds;
