import mongoose from "mongoose";
import { generateTicketNumber } from "../utils/generateTicketNumber.js";
const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storageName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: true },
);
const messageSchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    authorEmail: String,
    body: { type: String, default: "" },
    isInternalNote: { type: Boolean, default: false },
    attachments: [attachmentSchema],
  },
  { timestamps: true },
);
const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, index: true },
    subject: { type: String, required: true, trim: true, maxLength: 180 },
    description: { type: String, required: true, maxLength: 10000 },
    requesterId: { type: String, required: true, index: true },
    requesterName: String,
    requesterEmail: String,
    department: String,
    category: {
      type: String,
      enum: [
        "General",
        "Printer",
        "Network",
        "Email",
        "Access",
        "Hardware",
        "Software",
        "Security",
        "Other",
      ],
      default: "General",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["Open", "In progress", "Pending", "Resolved", "Closed"],
      default: "Open",
      index: true,
    },
    assigneeId: { type: String, default: null, index: true },
    assigneeName: { type: String, default: "Unassigned" },
    messages: [messageSchema],
    firstResponseAt: Date,
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ticketSchema.pre("validate", async function () {
  if (!this.ticketNumber && this.isNew) {
    this.ticketNumber = await generateTicketNumber();
  }
});

export default mongoose.model("Ticket", ticketSchema);
