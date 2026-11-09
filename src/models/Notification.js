import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["ticket_created", "new_message", "ticket_closed"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
