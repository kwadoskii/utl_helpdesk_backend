import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import Ticket from "../models/Ticket.js";
import { requireSupport } from "../middleware/auth.js";
import {
  notifySupportTeam,
  notifyTicketParticipants,
  getSupportNotificationRecipients,
  notifyUsers,
} from "../services/notificationService.js";
const router = Router();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(uploadRoot, { recursive: true });
const allowed = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const maxBytes = (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) =>
    cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
  limits: { fileSize: maxBytes, files: 5 },
  fileFilter: (_req, file, cb) =>
    cb(
      allowed.has(file.mimetype) ? null : new Error("Unsupported attachment type."),
      allowed.has(file.mimetype),
    ),
});
const fileMeta = (files) =>
  files.map((f) => ({
    originalName: path.basename(f.originalname),
    storageName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
  }));
const canRead = (t, u) =>
  u.roles?.includes("Support.Agent") ||
  u.groups?.includes(process.env.IT_SUPPORT_GROUP_ID) ||
  t.requesterId === u.id ||
  t.assigneeId === u.id;

router.get("/", async (req, res, next) => {
  try {
    const support =
      req.user.roles.includes("Support.Agent") ||
      req.user.groups.includes(process.env.IT_SUPPORT_GROUP_ID);
    const filter = support ? {} : { requesterId: req.user.id };
    if (req.query.mine === "true") filter.requesterId = req.user.id;
    if (req.query.assigned === "true") {
      if (!support)
        return res.status(403).json({ message: "Only support staff can view assigned tickets." });
      filter.assigneeId = req.user.id;
    }
    if (req.query.status) filter.status = req.query.status;
    const items = await Ticket.find(filter).sort({ updatedAt: -1 }); //.select("-messages");
    res.json(items);
  } catch (e) {
    next(e);
  }
});

router.get("/metrics", requireSupport, async (_req, res, next) => {
  try {
    const [total, open, inProgress, resolved, closed, avg] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: "Open" }),
      Ticket.countDocuments({ status: "In progress" }),
      Ticket.countDocuments({ status: "Resolved" }),
      Ticket.countDocuments({ status: "Closed" }),
      Ticket.aggregate([
        {
          $match: {
            closedAt: { $ne: null },
          },
        },
        {
          $project: {
            createdAt: {
              $convert: { input: "$createdAt", to: "date", onError: null, onNull: null },
            },
            closedAt: {
              $convert: { input: "$closedAt", to: "date", onError: null, onNull: null },
            },
          },
        },
        { $match: { createdAt: { $ne: null }, closedAt: { $ne: null } } },
        { $project: { duration: { $subtract: ["$closedAt", "$createdAt"] } } },
        { $group: { _id: null, avgMs: { $avg: "$duration" } } },
      ]),
    ]);
    res.json({
      total,
      open,
      inProgress,
      resolved,
      closed,
      averageCloseTimeMs: avg[0]?.avgMs ?? null,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/", upload.array("attachments", 5), async (req, res, next) => {
  try {
    const { subject, description, department, category, priority } = req.body;
    if (!subject?.trim() || !description?.trim())
      return res.status(400).json({ message: "Subject and description are required." });
    const t = await Ticket.create({
      subject: subject.trim(),
      description: description.trim(),
      department,
      category,
      priority,
      requesterId: req.user.id,
      requesterName: req.user.name,
      requesterEmail: req.user.email,
      messages: [
        {
          authorId: req.user.id,
          authorName: req.user.name || req.user.email,
          authorEmail: req.user.email,
          body: description.trim(),
          attachments: fileMeta(req.files || []),
        },
      ],
    });

    notifySupportTeam({
      excludeUserId: req.user.id,
      type: "ticket_created",
      emailEvent: "ticket_created",
      title: "New ticket created",
      message: `${t.requesterName || "A user"} created a ticket: ${t.subject}`,
      ticketId: t._id,
      ticket: t,
    });

    res.status(201).json(t);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const t = await Ticket.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Ticket not found." });
    if (!canRead(t, req.user)) return res.status(403).json({ message: "Not permitted." });
    res.json(t);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/messages", upload.array("attachments", 5), async (req, res, next) => {
  try {
    const t = await Ticket.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Ticket not found." });
    if (!canRead(t, req.user)) return res.status(403).json({ message: "Not permitted." });

    const body = String(req.body.body || "").trim();
    const files = req.files || [];

    if (!body && !files.length)
      return res.status(400).json({ message: "Message or attachment required." });

    if (t.status === "Closed")
      return res.status(409).json({ message: "Closed tickets cannot receive replies." });

    const internal = req.body.isInternalNote === "true";
    const isSupport =
      req.user.roles?.includes("Support.Agent") ||
      req.user.groups?.includes(process.env.IT_SUPPORT_GROUP_ID?.trim());

    if (internal && !isSupport) {
      return res.status(403).json({
        message: "Only support staff can add internal notes.",
      });
    }

    t.messages.push({
      authorId: req.user.id,
      authorName: req.user.name || req.user.email,
      authorEmail: req.user.email,
      body,
      isInternalNote: internal,
      attachments: fileMeta(files),
    });

    if (!t.firstResponseAt && req.user.id !== t.requesterId) t.firstResponseAt = new Date();
    if (t.status === "Open" && req.user.id !== t.requesterId) {
      t.status = "In progress";
      t.assigneeId = req.user.id;
      t.assigneeName = req.user.name;
    }
    await t.save();

    if (internal) {
      // Internal notes go only to IT Support members.
      // The note body is deliberately not included in the notification email.
      notifySupportTeam({
        excludeUserId: req.user.id,
        type: "new_message",
        emailEvent: "internalNote",
        title: "New internal note",
        message: `An internal note was added to: ${t.subject}`,
        ticketId: t._id,
      });
    } else {
      console.log(t);
      notifyTicketParticipants({
        ticket: t,
        excludeUserId: req.user.id,
        type: "new_message",
        emailEvent: "new_message",
        title: "New ticket message",
        message: `${req.user.name || req.user.email} replied to: ${t.subject}`,
        ticketId: t._id,
      });

      // Notify support when the requester replies to an
      // unassigned ticket.
      if (!t.assigneeId && req.user.id === t.requesterId) {
        notifySupportTeam({
          excludeUserId: req.user.id,
          type: "new_message",
          emailEvent: "new_message",
          title: "New ticket message",
          message: `A new reply was added to: ${t.subject}`,
          ticketId: t._id,
          ticket: t,
        });
      }
    }

    res.status(201).json(t);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/claim", requireSupport, async (req, res, next) => {
  try {
    const t = await Ticket.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Ticket not found." });
    if (t.assigneeId && t.assigneeId !== req.user.id)
      return res.status(409).json({ message: "Ticket is already assigned to another agent." });
    t.assigneeId = req.user.id;
    t.assigneeName = req.user.name || req.user.email;
    t.status = "In progress";
    await t.save();
    res.json(t);
  } catch (e) {
    next(e);
  }
});

// A ticket may be closed by its creator or an authorized support agent.
router.patch("/:id/close", async (req, res, next) => {
  try {
    const t = await Ticket.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Ticket not found." });

    const allowedGroup = (process.env.IT_SUPPORT_GROUP_ID || "").trim();
    const isSupport = Boolean(
      req.user?.roles?.includes("Support.Agent") ||
      (allowedGroup && req.user?.groups?.includes(allowedGroup)),
    );
    const isCreator = Boolean(t.requesterId && req.user?.id && t.requesterId === req.user.id);

    if (!isCreator && !isSupport)
      return res
        .status(403)
        .json({ message: "Only the ticket creator or MIS support staff can close this ticket." });

    const wasAlreadyClosed = t.status === "Closed";

    if (!wasAlreadyClosed) {
      t.status = "Closed";
      t.closedAt = new Date();
      await t.save();

      notifyTicketParticipants({
        ticket: t,
        excludeUserId: req.user.id,
        type: "ticket_closed",
        emailEvent: "ticket_closed",
        title: "Ticket closed",
        message: `Ticket "${t.subject}" has been closed.`,
        ticketId: t._id,
      });
    }

    return res.json(t);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/status", requireSupport, async (req, res, next) => {
  try {
    const { status, priority } = req.body;
    const t = await Ticket.findById(req.params.id);

    if (!t) return res.status(404).json({ message: "Ticket not found." });
    if (status && !["Open", "In progress", "Pending", "Resolved", "Closed"].includes(status))
      return res.status(400).json({ message: "Invalid status." });

    const previousStatus = t.status;

    if (status) {
      t.status = status;
      if (status === "Resolved") t.resolvedAt = new Date();
      if (status === "Closed") t.closedAt = new Date();
    }

    if (priority && ["Low", "Medium", "High", "Urgent"].includes(priority)) t.priority = priority;
    await t.save();

    if (status === "Closed" && previousStatus !== "Closed") {
      notifyTicketParticipants({
        ticket: t,
        excludeUserId: req.user.id,
        type: "ticket_closed",
        title: "Ticket closed",
        message: `Ticket "${t.subject}" has been closed.`,
        ticketId: t._id,
      });
    }
    res.json(t);
  } catch (e) {
    next(e);
  }
});

export default router;
