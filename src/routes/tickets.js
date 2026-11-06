import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import Ticket from "../models/Ticket.js";
import { requireSupport } from "../middleware/auth.js";
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
    if (internal && !req.user.roles.includes("Support.Agent"))
      return res.status(403).json({ message: "Only support staff can add internal notes." });
    t.messages.push({
      authorId: req.user.id,
      authorName: req.user.name || req.user.email,
      authorEmail: req.user.email,
      body,
      isInternalNote: internal,
      attachments: fileMeta(files),
    });
    if (!t.firstResponseAt && req.user.id !== t.requesterId) t.firstResponseAt = new Date();
    if (t.status === "Open" && req.user.id !== t.requesterId) t.status = "In progress";
    await t.save();
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
    if (t.status !== "Closed") {
      t.status = "Closed";
      t.closedAt = new Date();
      await t.save();
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
    if (status) {
      t.status = status;
      if (status === "Resolved") t.resolvedAt = new Date();
      if (status === "Closed") t.closedAt = new Date();
    }
    if (priority && ["Low", "Medium", "High", "Urgent"].includes(priority)) t.priority = priority;
    await t.save();
    res.json(t);
  } catch (e) {
    next(e);
  }
});

export default router;
