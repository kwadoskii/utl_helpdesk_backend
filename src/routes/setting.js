import { Router } from "express";
import Settings from "../models/Settings.js";
import { requireSupport } from "../middleware/auth.js";
import { encrypt } from "../utils/encryption.js";
import { sendTestEmail } from "../services/emailService.js";

const router = Router();

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne({ key: "global" });

  if (!settings) {
    settings = await Settings.create({ key: "global" });
  }

  return settings;
};

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const validPort = (value) =>
  Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535;

router.get("/", requireSupport, async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();

    const smtp = settings.smtp?.toObject ? settings.smtp.toObject() : settings.smtp;

    return res.json({
      smtp: {
        host: smtp.host || "",
        port: smtp.port || 587,
        encryption: smtp.encryption || "starttls",
        username: smtp.username || "",
        senderName: smtp.senderName || "",
        senderEmail: smtp.senderEmail || "",
        configured: Boolean(smtp.configured),
        hasPassword: Boolean(smtp.passwordEncrypted),
      },
      notifications: settings.notifications,
      general: settings.general,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    return res.status(500).json({
      message: "Unable to retrieve settings.",
    });
  }
});

router.put("/smtp", requireSupport, async (req, res, next) => {
  try {
    const { host, port, encryption, username, password, senderName, senderEmail } = req.body;

    if (
      !host?.trim() ||
      !validPort(port) ||
      !username?.trim() ||
      !senderName?.trim() ||
      !senderEmail?.trim()
    ) {
      return res.status(400).json({
        message: "Please provide all required SMTP configuration fields.",
      });
    }

    if (!validEmail(senderEmail.trim())) {
      return res.status(400).json({
        message: "Please provide a valid sender email address.",
      });
    }

    if (!["none", "ssl", "starttls"].includes(encryption)) {
      return res.status(400).json({
        message: "Invalid SMTP encryption method.",
      });
    }

    if (password !== undefined && typeof password !== "string") {
      return res.status(400).json({
        message: "Invalid SMTP password.",
      });
    }

    const settings = await getOrCreateSettings();

    const encryptedPassword =
      password?.length > 0 ? encrypt(password) : settings.smtp.passwordEncrypted;

    if (!encryptedPassword) {
      return res.status(400).json({
        message: "SMTP password is required for the initial configuration.",
      });
    }

    settings.smtp.host = host.trim();
    settings.smtp.port = Number(port);
    settings.smtp.encryption = encryption;
    settings.smtp.username = username.trim();
    settings.smtp.passwordEncrypted = encryptedPassword;
    settings.smtp.senderName = senderName.trim();
    settings.smtp.senderEmail = senderEmail.trim();
    settings.smtp.configured = true;
    settings.updatedBy = req.user.id;

    await settings.save();

    return res.json({
      success: true,
      message: "SMTP configuration saved successfully.",
      smtp: {
        host: settings.smtp.host,
        port: settings.smtp.port,
        encryption: settings.smtp.encryption,
        username: settings.smtp.username,
        senderName: settings.smtp.senderName,
        senderEmail: settings.smtp.senderEmail,
        configured: true,
        hasPassword: true,
      },
    });
  } catch (error) {
    console.error("Save SMTP settings error:", error);

    return res.status(500).json({
      message: "Unable to save SMTP configuration.",
    });
  }
});

router.post("/smtp/test", requireSupport, async (req, res) => {
  try {
    const { recipient } = req.body;

    if (!recipient || !validEmail(recipient)) {
      return res.status(400).json({
        message: "A valid test recipient email is required.",
      });
    }

    const result = await sendTestEmail(recipient.trim());

    return res.json(result);
  } catch (error) {
    console.error("SMTP test failed:", error);

    return res.status(400).json({
      success: false,
      message: "SMTP test failed. Check your configuration and credentials.",
    });
  }
});

router.put("/notifications", requireSupport, async (req, res) => {
  try {
    const allowedFields = ["ticketCreated", "newMessage", "internalNote", "ticketClosed"];

    const updates = {};

    for (const field of allowedFields) {
      if (typeof req.body[field] === "boolean") {
        updates[field] = req.body[field];
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        message: "No valid notification preferences supplied.",
      });
    }

    const settings = await getOrCreateSettings();

    Object.assign(settings.notifications, updates);
    settings.updatedBy = req.user.id;

    await settings.save();

    return res.json({
      success: true,
      message: "Notification preferences updated.",
      notifications: settings.notifications,
    });
  } catch (error) {
    console.error("Update notification settings error:", error);

    return res.status(500).json({
      message: "Unable to update notification preferences.",
    });
  }
});

router.put("/general", requireSupport, async (req, res) => {
  try {
    const { helpdeskName, defaultPriority, maxFileSizeMB, allowedFileTypes } = req.body;

    const settings = await getOrCreateSettings();

    if (helpdeskName !== undefined) {
      if (
        typeof helpdeskName !== "string" ||
        !helpdeskName.trim() ||
        helpdeskName.trim().length > 100
      ) {
        return res.status(400).json({
          message: "Helpdesk name must be between 1 and 100 characters.",
        });
      }

      settings.general.helpdeskName = helpdeskName.trim();
    }

    if (defaultPriority !== undefined) {
      if (!["Low", "Medium", "High", "Critical"].includes(defaultPriority)) {
        return res.status(400).json({
          message: "Invalid default ticket priority.",
        });
      }

      settings.general.defaultPriority = defaultPriority;
    }

    if (maxFileSizeMB !== undefined) {
      const size = Number(maxFileSizeMB);

      if (!Number.isInteger(size) || size < 1 || size > 10) {
        return res.status(400).json({
          message: "Attachment size must be between 1 and 10 MB.",
        });
      }

      settings.general.maxFileSizeMB = size;
    }

    if (allowedFileTypes !== undefined) {
      if (
        !Array.isArray(allowedFileTypes) ||
        allowedFileTypes.length > 20 ||
        allowedFileTypes.some((type) => typeof type !== "string" || !/^[a-z0-9]{1,10}$/i.test(type))
      ) {
        return res.status(400).json({
          message: "Invalid attachment file types.",
        });
      }

      settings.general.allowedFileTypes = [
        ...new Set(allowedFileTypes.map((type) => type.toLowerCase())),
      ];
    }

    settings.updatedBy = req.user.id;

    await settings.save();

    return res.json({
      success: true,
      message: "General settings updated successfully.",
      general: settings.general,
    });
  } catch (error) {
    console.error("Update general settings error:", error);

    return res.status(500).json({
      message: "Unable to update general settings.",
    });
  }
});

export default router;
