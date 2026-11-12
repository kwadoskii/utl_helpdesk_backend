import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      immutable: true,
    },

    smtp: {
      host: { type: String, default: "" },
      port: { type: Number, default: 587 },
      encryption: {
        type: String,
        enum: ["none", "ssl", "starttls"],
        default: "starttls",
      },
      username: { type: String, default: "" },
      passwordEncrypted: { type: String, default: "" },
      senderName: { type: String, default: "MIS Helpdesk" },
      senderEmail: { type: String, default: "" },
      configured: { type: Boolean, default: false },
    },

    notifications: {
      ticketCreated: { type: Boolean, default: true },
      newMessage: { type: Boolean, default: true },
      internalNote: { type: Boolean, default: true },
      ticketClosed: { type: Boolean, default: true },
    },

    general: {
      helpdeskName: {
        type: String,
        default: "MIS Helpdesk",
      },
      defaultPriority: {
        type: String,
        enum: ["Low", "Medium", "High", "Critical"],
        default: "Medium",
      },
      maxFileSizeMB: {
        type: Number,
        default: 10,
        min: 1,
        max: 100,
      },
      allowedFileTypes: {
        type: [String],
        default: ["jpg", "jpeg", "png", "pdf", "doc", "docx", "txt"],
      },
    },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Settings", settingsSchema);
